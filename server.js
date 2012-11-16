var io = require("socket.io");
var server = io.listen(1337).set("log level", 1);
var fs = require("fs");

var players = [];
var matches = [];

//CONSTANTS
const MATCH_INACTIVITY_THRESHOLD = 300000;
const HYGENE_INTERVAL = 10000;

// player class
var Player = (function() {
	function Player(uid_, name_) {
		this.uid = uid_;
		this.name = name_;
		this.socket = null;
		this.picturesMade = 0;
	}

	return Player;
})();


// match class
var Match = (function() {
	function Match(title_, secondsPerRound_, numRounds_) {
		this.title = title_;
		this.secondsPerRound = secondsPerRound_;
		this.numRounds = numRounds_;
		this.currentRound = 0;
		this.players = [];
		this.matchID = randomString(64);
		this.maxNumPlayers = 5;
		this.status = "waitingForPlayers";
		this.lastActionTime = new Date().getTime();
		this.currentOwner = "";
	}
	return Match; 
})();

//will be called at a steady interval to clean server of abandoned and timed out matches
function onHygeneTimer() {

	var now = new Date().getTime();
	var markedIndeces = new Array();

	//mark inactive matches
	for( var i = 0; i < matches.length; i++ ) {
		var match = matches[i];
		var inactiveTime = now - match.lastActionTime;
		if( inactiveTime >= MATCH_INACTIVITY_THRESHOLD ) {
			match.status = "markedForDeletion";
			markedIndeces.push(i);
		}
	}

	//now destroy all marked matches
	for( var j = 0; j < markedIndeces.length; j++ ) {
		var matchIndex = markedIndeces[j];
		var match = matches[matchIndex];
		destroyMatch(match, "inactivity");
	}
};

//start hygene timer
setInterval( onHygeneTimer, HYGENE_INTERVAL);

//start server
server.sockets.on("connection", function(socket) {
	socket.on("msg", function(data){
		server.sockets.emit("broadcast", "serverMSG");
		socket.emit("msg", "serverMSG");
		console.log(""+(new Date()) + ": incomig msg: " + data);
	});

	socket.on("disconnect", function() {
		//notify all clients that the player has dropped out
		server.sockets.emit("playerDisconnected", socket.player);

		//remove player from all matches he is currently registered in
		for( var matchIndex = 0; matchIndex < matches.length; matchIndex++ ) {
			var match = matches[matchIndex];
			removePlayerFromMatch(socket.player, match);
		}

		//remove player from current player list
		for( var i = 0; i < players.length; i++ ) {
			var player = players[i];
			if( player === socket.player ) {
				players.slice(i, 1);
				break;
			}	
		}

		console.log(""+(new Date()) + ": player disconnected: %j ", socket.player);
		
		socket.player = null;
	});

	socket.on("signIn", function(player) {
		//check for possible double entry
		for(var i = 0; i < players.length; i++) {
			var thisPlayer = players[i];
			if( thisPlayer.uid == player.uid ) {
				//remove this player from the array and add it again with the new name
				players.splice(i, 1);
				break;
			}
		}
		//add player to array
		players.push(player);

		socket.player = player;

		socket.emit("addedPlayer", player);
		console.log(""+(new Date()) + ": signed in player: %j", player);
	});
	
	//request new match
	socket.on("createMatch", function(data) {
	//	console.log(""+(new Date()) + ": createMatch: %j ", data);
		if(socket.player === 'undefined') {
			console.log(""+(new Date()) + ": ERROR: player not bound to socket!");
			socket.emit("newMatchCreationFailed", "Internal server error. Please sign out and sign in again.");
			return;
		}

		console.log(""+(new Date()) + ": match request from player: " + socket.player.uid);
		
		//check whether player is already in match
		for( var mi = 0; mi < matches.length; mi++) {
			var m = matches[mi];
			for(var pi = 0; pi < m.players.length; pi++ ) {
				var p = m.players[pi];
				if(socket.player === p) {
					console.log(""+(new Date()) + ": ERROR: player already in match " + m.matchID);
					socket.emit("newMatchCreationFailed", "You already registered in match #" + m.matchID);
					return;
				}
			}
		}

		//parse user input
		var matchData = data;
		var title = matchData.title;
		var secondsPerRound = matchData.secondsPerRound;
		var numRounds = matchData.numRounds;
		var maxPlayers = matchData.maxPlayers;

		//create new match object
		var newMatch = new Match(title, secondsPerRound, numRounds);
		newMatch.maxNumPlayers = maxPlayers;
		matches.push(newMatch);
		newMatch.currentOwner = socket.player.uid;

		//add player to match
		newMatch.players.push(socket.player);

		socket.emit("newMatchCreated", newMatch);
		socket.broadcast.emit("playerJoinedMatch", newMatch);
		console.log(""+(new Date()) + ": new match created: ", + newMatch.matchID);
	
		createMatchFile(newMatch);	
	});

	socket.on("getMatches", function(data) {
		console.log(""+(new Date()) + ": matches list requested from " + socket.player.uid + "; sending " + matches.length + " matches...");
		socket.emit("provideMatchesList", matches);
	});

	socket.on("joinMatch", function(data) {
		var match = findMatchByID(data.matchID);

		if( null == match ) {
			console.log(""+new Date() + ": ERROR: could not find match with ID " + data.matchID);
			socket.emit("error", "The server could not find your match!");
			return;
		}
		var ok = joinMatch(socket.player, match);
		if( ok ) {
			console.log(""+(new Date()) + ": player " + socket.player.uid + "joined match + " + match.matchID);
			socket.emit("joinSucceeded", match);
			socket.broadcast.emit("playerJoinedMatch", match);
			match.lastActionTime = new Date().getTime();
		}
		else {
			console.log(""+(new Date()) + ": player " + socket.player.uid + " could not join match " + match.matchID);
			socket.emit("joinFailed", match);
		}
	});

	socket.on("leaveMatch", function(data) {
		var match = findMatchByID(data.matchID);

		if( null == match ) {
			console.log(""+new Date() + ": ERROR: could not find match with ID " + data.matchID);
			socket.emit("error", "The server could not find your match!");
			return;
		}

		removePlayerFromMatch(socket.player, match);
	
		server.sockets.emit("playerLeftMatch", match);
		match.lastActionTime = new Date().getTime();	
	});

	socket.on("requestMatchStart", function(data) {
		var match = findMatchByID(data.matchID);

		if( null == match ) {
			console.log(""+new Date() + ": ERROR: could not find match with ID " + data.matchID);
			socket.emit("error", "The server could not find your match!");
			return;
		}
	
		//start match
		match.status = "running";

		server.sockets.emit("matchStarted", match);
		match.lastActionTime = new Date().getTime();	
		console.log(""+new Date()+": match #" + match.matchID + " started! " + match.matchID);
	});

	socket.on("ping", function( data ) {	
		console.log(""+(new Date()) + ": PING with data: " + data);
		socket.emit("pingBack", matches.length);
	});

	socket.on("sendImage", function(data) {
		console.log("received image data");
		var dataBuffer = new Buffer(data.imageData, 'base64');
		socket.player.picturesMade = socket.player.picturesMade + 1;
		console.log("player made " + socket.player.picturesMade + " pictures so far");
		var match = findMatchByID(data.matchID);

		if( null == match ) {
			console.log(""+new Date() + ": ERROR: could not find match with ID " + data.matchID);
			socket.emit("error", "The server could not find your match!");
			return;
		}

		saveImage(dataBuffer, match, socket.player);		
	});
});

//////////////////////////////
// HELPERS                  //
//////////////////////////////


//////////////////////////
// FILE IO		//
//////////////////////////

function createMatchFile(match_) {
	var directory = "./" + match_.matchID;
	
	///check if match directory exists
	if( !dirExistsSync(directory) ) {
		//create match directory and match info file
		fs.mkdirSync(directory);
		var infoFilename = directory + "/match.json";
		var matchString = JSON.stringify(match_, null, 4);
		fs.writeFileSync(infoFilename, matchString, "ascii", function(err) {
			console.log("" + new Date() + ": ERROR writing match info file to " + infoFilename + "! " + err);
		});	
	}	
}

function dirExists (d, cb) {
  fs.stat(d, function (er, s) { cb(!er && s.isDirectory()) })
}

function dirExistsSync (d) {
  	try { fs.statSync(d).isDirectory() }
  	catch (er) { return false }
	
	return true;
}

function saveImage(dataBuffer_, match_, player_) {
	var directory = "./" + match_.matchID;
	
	var filename = directory + "/" + player_.uid + "_" + player_.picturesMade + ".jpg";

	fs.writeFile(filename, dataBuffer_, function(err) {
		if(null == err ) {
			console.log("" + new Date() + ": INFO written image file to " + filename + "");
		}
		else {
			console.log("" + new Date() + ": ERROR writing image file to " + filename + "! " + err);
		}
	});
};

function getImageFilenamesForPlayerAndMatch(player_, match_) {
	
};

//////////////////////////
// OBJECT FINDERS	//
//////////////////////////

function findMatchByID(matchID_) {
	for( var i = 0; i < matches.length; i++) {
		var match = matches[i];
		if( match.matchID === matchID_ ) {
			return match;
		}
	}

	return null;
}

function findSocketWithPlayer(player_) {
	//console.log(""+(new Date()) + ": \n\nDEBUG: server has sockets " + server.sockets.clients().length + "\n\n");
	for( var si = 0; si < server.sockets.clients().length; si++ ) {
		var currentSocket = server.sockets.clients()[si];
		if( currentSocket.player === player_ ) {
			return currentSocket;
		}
	}

	return null;
};

function removePlayerFromMatch(player_, match_) {
	for( var playerIndex = 0; playerIndex < match_.players.length; playerIndex++ ) {
		var player = match_.players[playerIndex];
		if( player === player_ ) {
			match_.players.splice(playerIndex, 1);
			console.log(""+(new Date()) + ": removed player " + player_.uid + " from match \"" + match_.title + "\"");
			break;
		}
	}		
	
	//match empty of players? remove match!
	if( match_.players.length == 0 ) {
		destroyMatch( match_, "No players left in the match." );
		return;
	}	

	//transfer ownership of match, if necessary
	if( match_.currentOwner == player_.uid ) {
		var player = match_.players[0];
		match_.currentOwner = player.uid;
		var playerSocket = findSocketWithPlayer(player);
		console.log(""+(new Date()) + ": transfered match (#" + match_.matchID + ") ownership to " + player.name );
			
		//notify player
		playerSocket.emit("matchOwnerShipTransfered", match_);
		
	}	
};

function destroyMatch( match_, reason_ ) {
	// first, notify all players that the match will be killed
	for( var pi = 0; pi < match_.players.length; pi++ ) {
		var player = match_.players[pi];
		var playerSocket = findSocketWithPlayer(player);
		if( null != playerSocket ) {
			playerSocket.emit("matchDestroyed", reason_);
		}
		else {
			console.log(""+(new Date()) + ": ERROR: destroyMatch(): could not find socket of player %j", player);
		} 
	}

	for( var mi = 0; mi < matches.length; mi++ ) {
		var m = matches[mi];
		if( m === match_ ) {
			matches.splice(mi, 1);	
			console.log(""+(new Date()) + ": destroyed match " + match_.matchID);
			return;
		}
	}

	console.log(""+(new Date()) + ": ERROR: could not find %j in match array!", match_);	
};

function joinMatch(player_, match_) {
	console.log(""+(new Date()) + ": player wants to join: %j -> %j...", player_, match_);
		
	//game in lobby mode?
	if( match_.status != "waitingForPlayers" ) {
		console.log(""+(new Date()) + ": ...fail! match is no longer in lobby mode!");
		return false;
	}

	//player cap for match reached?
	if( match_.players.length == match_.maxNumPlayers ) {
		console.log(""+(new Date()) + ": ...fail! player cap reached: " + match_.maxNumPlayers);
		return false;
	}

	// no double booking!
	for( var pi = 0; pi < match_.players.length; pi++ ) {
		var matchPlayer = match_.players[pi];
		if( player_ === matchPlayer ) {
			console.log(""+(new Date()) + ": ...fail! player is already in match!");
			return false;
		}
	}

	match_.players.push(player_);
	console.log(""+(new Date()) + ": ...success! new players: %j", match_.players);

	return true;
};

function randomString(bits) {
	var chars,rand,i,ret;

  	chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-';
  	ret='';

  	// in v8, Math.random() yields 32 pseudo-random bits (in spidermonkey it gives 53)

 	while(bits > 0){

    		rand=Math.floor(Math.random()*0x100000000) // 32-bit integer

    		// base 64 means 6 bits per character, so we use the top 30 bits from rand to give 30/6=5 characters.

    		for(i=26; i>0 && bits>0; i-=6, bits-=6) ret+=chars[0x3F & rand >>> i]
	}

  	return ret;
};
