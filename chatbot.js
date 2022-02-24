const fs = require("fs");
const mysql = require("mysql");
const { Client, Location, List, Buttons } = require("./index");
const { Contact } = require("./src/structures");

/***************Database Connection**************************/

const db = mysql.createConnection({
	host: "localhost",
	user: "root",
	password: "",
	database: "swayam_prabha_chatbot",
});

db.connect(function (err) {
	if (err) throw err;
	console.log("Database Connected...");
});

/*****************Database Connected****************************/

const SESSION_FILE_PATH = "./session.json";
let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
	sessionCfg = require(SESSION_FILE_PATH);
}

const client = new Client({
	puppeteer: { headless: false },
	session: sessionCfg,
});

// You can use an existing session and avoid scanning a QR code by adding a "session" object to the client options.
// This object must include WABrowserId, WASecretBundle, WAToken1 and WAToken2.

// You also could connect to an existing instance of a browser
// {
//    puppeteer: {
//        browserWSEndpoint: `ws://localhost:3000`
//    }
// }

client.initialize();

client.on("qr", (qr) => {
	// NOTE: This event will not be fired if a session is specified.
	console.log("QR RECEIVED", qr);
});

client.on("authenticated", (session) => {
	console.log("AUTHENTICATED", session);
	sessionCfg = session;
	fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
		if (err) {
			console.error(err);
		}
	});
});

client.on("auth_failure", (msg) => {
	// Fired if session restore was unsuccessfull
	console.error("AUTHENTICATION FAILURE", msg);
});

client.on("ready", () => {
	console.log("READY");
});

client.on("message", async (msg) => {
	console.log("MESSAGE RECEIVED", msg);

	/******************Saving user number in Master Table*******And update last_msg_time************/

	let msg_type = msg.type;
	if (msg_type == "chat") {
		const check_usr_num_from_database = `SELECT num_id FROM user_num_table WHERE user_num = "${msg.from}" `;
		db.query(check_usr_num_from_database, (error, result, fields) => {
			if (error) {
				return console.error(error.message);
			} else if (result == "") {
				// Create new row and save number
				const insert_number = ` INSERT INTO user_num_table (user_num, last_msg_time, user_state) VALUES ("${msg.from}", NOW(), 0) `;
				db.query(insert_number, function (err, result) {
					if (err) throw err;
				});
			} else {
				const update_lastMsgTime = ` UPDATE user_num_table SET last_msg_time = NOW() WHERE user_num = "${msg.from}" `;
				db.query(update_lastMsgTime, function (err, result) {
					if (err) throw err;
				});
			}
		});
	}

	/*******************************Get user state***********Set user State*******************/

	function get_user_state(state_of_user) {
		const _user_state = `SELECT user_state FROM user_num_table WHERE user_num = "${msg.from}" `;
		db.query(_user_state, function (error, result, fields) {
			if (error) {
				return console.error(error.message);
			} else if (result == "") {
				return state_of_user(0);
			} else {
				result.forEach((result) => {
					return state_of_user(result.user_state);
				});
			}
		});
	}

	function set_user_state(state_value) {
		const _user_state_set = ` UPDATE user_num_table
		SET user_state = ${state_value}
		WHERE user_num = "${msg.from}" `;
		db.query(_user_state_set, (error, result, fields) => {
			if (error) {
				return console.error(error.message);
			}
		});
	}

	function nullFromDataBase() {
		let bot_reply = "Please provide input from the options.";
		client.sendMessage(msg.from, bot_reply);
		save_message_reply(bot_reply);
	}

	// function to save user messages and reply in database
	function save_message_reply(reply_msg) {
		const number_id = ` SELECT num_id FROM user_num_table WHERE user_num = "${msg.from}" `;
		db.query(number_id, function (error, result) {
			if (error) {
				return console.error(error.message);
			}
			result.forEach((result) => {
				const insert_data = ` INSERT INTO user_msg_table (num_id, msg_date, message, reply) 
			VALUES ("${result.num_id}", NOW(), "${msg.body}", "${reply_msg}") `;
				db.query(insert_data, function (err, result) {
					if (err) throw err;
				});
			});
		});
	}

	const reset_user_state = ` UPDATE user_num_table SET user_state = 0 WHERE last_msg_time < (NOW() - INTERVAL 3 MINUTE); `;
	db.query(reset_user_state, (error, result, fields) => {
		if (error) {
			return console.error(error.message);
		}
	});

	/**************************Getting reply from Database*****SWITCH CASE*********LIKE '%`+msg.body+`%'**********/

	switch (msg_type) {
		case "chat":
			if (msg.body == "0") {
				set_user_state(0);
			}

			get_user_state((state_of_user) => {
				switch (state_of_user) {
					case 0:
						const sql = `SELECT responses FROM chatbot_responses WHERE category = 'Initialise' `;
						db.query(sql, (error, result, fields) => {
							if (error) {
								return console.error(error.message);
							}
							result.forEach((result) => {
								client.sendMessage(msg.from, result.responses);
								save_message_reply(result.responses);
							});
							state_of_user++;
							set_user_state(state_of_user);
						});
						break;

					case 1:
						const check_usr_msg_from_database_welcome = ` SELECT user_msg FROM chatbot_responses WHERE user_msg = "${msg.body}" AND category = 'Welcome' `;
						db.query(
							check_usr_msg_from_database_welcome,
							(error, result, fields) => {
								console.log(result); // Checking Result
								if (error) {
									return console.error(error.message);
								} else if (result == "") {
									console.log("State 3");
									nullFromDataBase();
								} else {
									console.log("Result State 2 ==> " + result);
									//User message matches with Database
									const sql = `SELECT responses FROM chatbot_responses WHERE user_msg  = "${msg.body}" AND category = 'Welcome' `;
									db.query(sql, (error, result, fields) => {
										if (error) {
											return console.error(error.message);
										}
										result.forEach((result) => {
											client.sendMessage(msg.from, result.responses);
											save_message_reply(result.responses);
										});
										if (msg.body == "1") {
											set_user_state(2);
										} else if (msg.body == "2") {
											set_user_state(3);
										}
									});
								}
							}
						);

						break;

					case 2:
						const check_usr_msg_from_database_HE = `SELECT user_msg FROM chatbot_responses WHERE user_msg = "${msg.body}" AND category = 'HE' `;
						db.query(
							check_usr_msg_from_database_HE,
							(error, result, fields) => {
								if (error) {
									return console.error(error.message);
								} else if (result == "") {
									nullFromDataBase();
								} else {
									//User message matches with Database
									const sql = `SELECT responses FROM chatbot_responses WHERE user_msg  = "${msg.body}" AND category = 'HE' `;
									db.query(sql, (error, result, fields) => {
										if (error) {
											return console.error(error.message);
										}
										result.forEach((result) => {
											client.sendMessage(msg.from, result.responses);
											save_message_reply(result.responses);
										});
										if (msg.body == "3") {
											set_user_state(4);
										} else if (msg.body == "2") {
											//report issue Higher Education
											set_user_state(6);
										} else if (msg.body == "4") {
											//feedback Higher Education
											set_user_state(7);
										}
									});
								}
							}
						);
						break;

					case 3:
						const check_usr_msg_from_database_SE = `SELECT user_msg FROM chatbot_responses WHERE user_msg = "${msg.body}" AND category = 'SE' `;
						db.query(
							check_usr_msg_from_database_SE,
							(error, result, fields) => {
								if (error) {
									return console.error(error.message);
								} else if (result == "") {
									nullFromDataBase();
								} else {
									//User message matches with Database
									const sql = `SELECT responses FROM chatbot_responses WHERE user_msg  = "${msg.body}" AND category = 'SE' `;
									db.query(sql, (error, result, fields) => {
										if (error) {
											return console.error(error.message);
										}
										result.forEach((result) => {
											client.sendMessage(msg.from, result.responses);
											save_message_reply(result.responses);
										});
										if (msg.body == "3") {
											set_user_state(5);
										} else if (msg.body == "2") {
											// Report issue School Education
											set_user_state(8);
										} else if (msg.body == "4") {
											// Feedback School Education
											set_user_state(9);
										}
									});
								}
							}
						);
						break;

					case 4:
						const check_usr_msg_from_database_HEFAQ = `SELECT user_msg FROM chatbot_responses WHERE user_msg = "${msg.body}" AND category = 'HEFAQ' `;
						db.query(
							check_usr_msg_from_database_HEFAQ,
							(error, result, fields) => {
								if (error) {
									return console.error(error.message);
								} else if (result == "") {
									nullFromDataBase();
								} else {
									//User message matches with Database
									const sql = `SELECT responses FROM chatbot_responses WHERE user_msg  = "${msg.body}" AND category = 'HEFAQ' `;
									db.query(sql, (error, result, fields) => {
										if (error) {
											return console.error(error.message);
										}
										result.forEach((result) => {
											client.sendMessage(msg.from, result.responses);
											save_message_reply(result.responses);
										});
									});
								}
							}
						);

						break;

					case 5:
						const check_usr_msg_from_database_SEFAQ = `SELECT user_msg FROM chatbot_responses WHERE user_msg = "${msg.body}" AND category = 'SEFAQ' `;
						db.query(
							check_usr_msg_from_database_SEFAQ,
							(error, result, fields) => {
								console.log("1 st result -> " + result);
								if (error) {
									return console.error(error.message);
								} else if (result == "") {
									console.log("Result is Null");
									nullFromDataBase();
								} else {
									console.log("2  result -> " + result);
									console.log("Result is not Null");
									//User message matches with Database
									const sql = `SELECT responses FROM chatbot_responses WHERE user_msg  = "${msg.body}" AND category = 'SEFAQ' `;
									db.query(sql, (error, result, fields) => {
										if (error) {
											return console.error(error.message);
										}
										result.forEach((result) => {
											client.sendMessage(msg.from, result.responses);
											save_message_reply(result.responses);
										});
									});
								}
							}
						);

						break;

					case 6:
						let bot_reply_HE_issue =
							"Thank you for providing the details about the issue. We will resolve the issue";
						client.sendMessage(msg.from, bot_reply_HE_issue);
						save_message_reply(bot_reply_HE_issue);
						set_user_state(0);

						break;

					case 7:
						let bot_reply_HE_feedback = "Thank you for providing feedback.";
						client.sendMessage(msg.from, bot_reply_HE_feedback);
						save_message_reply(bot_reply_HE_feedback);
						set_user_state(0);

						break;
					case 8:
						let bot_reply_SE_issue =
							"Thank you for providing the details about the issue. We will resolve the issue";
						client.sendMessage(msg.from, bot_reply_SE_issue);
						save_message_reply(bot_reply_SE_issue);
						set_user_state(0);

						break;

					case 9:
						let bot_reply_SE_feedback = "Thank you for providing feedback.";
						client.sendMessage(msg.from, bot_reply_SE_feedback);
						set_user_state(0);
						save_message_reply(bot_reply_SE_feedback);

						break;
				}
			});
			break;

		case "image":
			msg.reply("Please don't send images.");
			break;

		case "document":
			msg.reply("Please don't send document.");
			break;

		case "audio":
			msg.reply("Please don't send audio messages.");
			break;

		case "ptt": //recorded voice messages
			msg.reply("Please don't send voice recorded messages.");
			break;

		case "video":
			msg.reply("Please don't send video messages.");
			break;

		case "sticker":
			msg.reply("Sticker messages are not understood");
			break;

		case "location":
			msg.reply("Please don't send your location.");
			break;

		case "vcard":
			msg.reply("Please don't send Contatcs");
			break;
	}
});

client.on("message_revoke_everyone", async (msg) => {
	// Fired whenever a message is deleted by anyone (including you)

	client.sendMessage(msg.from, "Please do not delete sent messages.");
});

client.on("message_create", (msg) => {
	// Fired on all message creations, including your own
	if (msg.fromMe) {
		// do stuff here
	}
});

client.on("message_revoke_me", async (msg) => {
	// Fired whenever a message is only deleted in your own view.
	console.log(msg.body); // message before it was deleted.
});

client.on("message_ack", (msg, ack) => {
	/*
        == ACK VALUES ==
        ACK_ERROR: -1
        ACK_PENDING: 0
        ACK_SERVER: 1
        ACK_DEVICE: 2
        ACK_READ: 3
        ACK_PLAYED: 4
    */

	if (ack == 3) {
		// The message was read
	}
});

client.on("change_battery", (batteryInfo) => {
	// Battery percentage for attached device has changed
	const { battery, plugged } = batteryInfo;
	console.log(`Battery: ${battery}% - Charging? ${plugged}`);
});

client.on("change_state", (state) => {
	console.log("CHANGE STATE", state);
});

client.on("disconnected", (reason) => {
	console.log("Client was logged out", reason);
});
