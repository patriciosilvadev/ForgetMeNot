const chatbotController = require('../controller/chatbot');

const request = require('request');
const properties = require('../config/properties.js');
const schedule = require('node-schedule');
const chrono = require('chrono-node')
const crypto = require("crypto");
const Q = require("q");
const SlackBot = require('slackbots');

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'log'});
// tracer.setLevel('error');

// Slackbot DOCS: https://api.slack.com/bot-users

/*

	1. Setting up back-n-forth comms

	* The primary way bot users interact with people on a given workspace is by connecting to the Real Time Messaging API (RTM API for short) and opening up a websocket connection with Slack.
	** DOCS: https://api.slack.com/rtm

	* (The Events API is an alternative way to receive and respond to events as a bot user contained within a Slack App. Instead of connecting over a websocket, you subscribe to specific events and messages and Slack sends them to your server.)

*/

/*

	2. Sending messages to individuals

	* chat.postEphemeral method allows a bot user to post a complex message visible only to a specific user and context.
	** DOCS: https://api.slack.com/methods/chat.postEphemeral

	* The bot user can also use the Web API to add emoji reactions to messages, upload files, pin and star messages, and generally behave like any other user on the workspace.

*/

/*

	3. Channel-wide comms

	* Web API method chat.postMessage. Set as_user to true to send messages as your bot with its username and profile image.

*/

// Dev
initateSlackBot({
	bot_access_token: "xoxb-248382524992-erAIp1lU41jRmlS4fuxWHXwW",
	bot_user_id: "U7AB8FEV6"
});

exports.oauth = function(req, res) {
	// Lifted from https://api.slack.com/tutorials/tunneling-with-ngrok

	// When a user authorizes an app, a code query parameter is passed on the oAuth endpoint. If that code is not there, we respond with an error message
    if (!req.query.code) {
        res.status(500);
        res.send({"Error": "Looks like we're not getting code."});
        console.log("Looks like we're not getting code.");
    } else {
        // If it's there...

        // We'll do a GET call to Slack's `oauth.access` endpoint, passing our app's client ID, client secret, and the code we just got as query parameters.
        request({
            url: 'https://slack.com/api/oauth.access', //URL to hit
            qs: {code: req.query.code, client_id: properties.slack_client_id, client_secret: properties.slack_client_secret}, //Query string data
            method: 'GET', //Specify the method
        }, function (error, response, body) {
            if (error) {
                console.log(error);
            } else {
								var slackKeychain = JSON.parse(body)
								console.log("🤓 Bot was authorised", slackKeychain)
                res.json(slackKeychain);

								// TODO: Store this token in an encrypted DB so we can bootstrap bots after server restart
								initateSlackBot(slackKeychain.bot)

								/*
								TODO: Render a 'success' page
									* that tells people how to user ForgetMeNot
									* button to redirect them to channel

								TODO: Store `body`
									* Stash channel as a user (ish)
									* Stash webhook and access_token

								{
								    "access_token": "xoxp-XXXXXXXX-XXXXXXXX-XXXXX",
								    "scope": "incoming-webhook,commands,bot",
								    "team_name": "Team Installing Your Hook",
								    "team_id": "XXXXXXXXXX",
								    "incoming_webhook": {
								        "url": "https://hooks.slack.com/TXXXXX/BXXXXX/XXXXXXXXXX",
								        "channel": "#channel-it-will-post-to",
								        "configuration_url": "https://teamname.slack.com/services/BXXXXX"
								    },
								    "bot":{
								        "bot_user_id":"UTTTTTTTTTTR",
								        "bot_access_token":"xoxb-XXXXXXXXXXXX-TTTTTTTTTTTTTT"
								    }
								}
								*/
            }
        })
    }
}

var bot;

function initateSlackBot(botKeychain) {
	// create a bot
	bot = new SlackBot({
	    token: botKeychain.bot_access_token
	});

	console.log('New Slackbot connecting.')

	bot.on('open', () => console.log("Slackbot opened websocket.",...arguments))
	bot.on('errror', () => console.log("Slackbot 👺 ERR'D OUT while connecting.",...arguments))
	bot.on('close', () => console.log("Slackbot 👺 CLOSED a websocket.",...arguments))

	bot.on('start', () => {
		console.log('Slackbot has 🙏 connected.',...arguments)

		// TODO: Remove after debug
    bot.postMessageToChannel('bot-testing', `*I'm your personal mind-palace. Invite me to this channel and ask me to remember things :)*`, {
        icon_emoji: ':sparkles:'
    });
	});

	bot.on('message', (message) => {
		console.log("Slack event:", message)

		// For now, just listen to direct addresses
		// TODO: In private messages, no address should be necessary
		var formsOfAddress = new RegExp(`^@?forgetmenot,?\s*|^<@?${botKeychain.bot_user_id}>,?\s*`,'i');
		if(message.type === "message" && formsOfAddress.test(message.text)) {
			console.log("Handing this bad boy off to 😈 CHATBOT")
			var payload = message;

			// Remove reference to @forgetmenot
			payload.text = payload.text.replace(formsOfAddress, '')

			// Should send data to Chatbot and return messages for emitting
			// TODO: Also support postEphemeral(id, user, text, params)
			handleMessage(
				payload,
				(text, options = {}) => bot.postMessage(message.channel, text, options)
			)
		}
	})
}

// If we want to use the Event API instead...
exports.handleEvent = function(req, res) {
	console.log("New Slack event:",req.body)
	// return res.send(req.body.challenge); // Should only be needed once, to confirm URL
}

handleMessage = function(payload, emitter) {
	// Transform into Facebook format.
	var payloadFormatted = { entry: [ { messaging: [ {
		sender: { id: payload.user },
		message: { text: payload.text }
	} ] } ] }

  logger.trace()
  // logger.log(req)
  chatbotController.handleMessage(payloadFormatted)
  .then(function(apiResult) {
    logger.log(JSON.stringify(apiResult, null, 2))
		// Message formatting DOCS: https://api.slack.com/docs/messages
    return handleResponseGroup(emitter, apiResult)
  })
	.catch(function(e) {
    logger.error(e);
  })
}

const handleResponseGroup = function(emitter, response) {
  const d = Q.defer();
  const promises = []
  if (response && response.messageData) {
    response.messageData.forEach(function(singleResponse) {
      promises.push(prepareAndSendResponses(emitter, singleResponse.data, singleResponse.delay || 0))
    })
  }
  Q.allSettled(promises)
  .then(function() {
    d.resolve()
  }).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
  return d.promise;
}

function prepareAndSendResponses(emitter, responseData, delay) {
	logger.trace(prepareAndSendResponses);
	if (responseData.json) console.log(responseData.json.message); // ???
	const d = Q.defer();
	const responseDataArray = (responseData.message && responseData.message.text) ? [responseData] : [false];
  if (responseData.message.attachment) {
    const attachmentResponseData = JSON.parse(JSON.stringify(responseData))
    delete attachmentResponseData.message.text
    responseDataArray.push(attachmentResponseData)
  }
  logger.trace()
	Q.allSettled(
		responseDataArray.map(function(thisResponse, i, array) {
      if (thisResponse.message.attachment) i = Math.max(i-1, 0) // Stop attachements from delaying before sending
			return sendResponseAfterDelay(emitter, thisResponse, delay + i*2000);
		})
	).then(function(results) {
		logger.log(results)
		d.resolve(results)
	}).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
	return d.promise;
}

function sendResponseAfterDelay(emitter, thisResponse, delay) {
	logger.trace(sendResponseAfterDelay);
	const d = Q.defer();
	var params = {}
	if(thisResponse.quick_replies && thisResponse.quick_replies.length > 0) {
		params.attachments = [
			{
        "attachment_type": "default",
        "actions": []
      }
		]
		thisResponse.quick_replies.forEach(reply => {
			params.attachments.push({
				"type": "button",
				"name": reply.title,
				"text": reply.title,
				"value": reply.payload
			})
		})
	}
	// if (!thisResponse.sender_action) sendSenderAction(thisResponse.recipient.id, 'typing_on');
	setTimeout(function() {
		// console.log("I'm about to echo ==>", thisResponse, params)
		// TODO: Setup buttons
		// bot.postMessage
		emitter(thisResponse.message.text, params)
		.then(x => d.resolve("200 Emitted response",x))
		.catch(err => d.reject("ERROR Emitted response",err))
	}, delay);
	return d.promise;
}

// function sendSenderAction(recipientId, sender_action) {
// 	logger.trace(sendSenderAction);
// 	const d = Q.defer()
//   var responseData = {
//     recipient: {
//       id: recipientId
//     },
//     sender_action: sender_action
//   };
// 	callSendAPI(responseData, properties.facebook_message_endpoint)
// 	.then(function(body) {
// 		d.resolve(body)
// 	}).catch(function(err) {
//     logger.error(err)
// 		d.reject(err)
// 	});
// 	return d.promise
// }
