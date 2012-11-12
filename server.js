var io = require("socket.io");
var server = io.listen(1337).set("log level", 1);

var players = [];
var matches = [];

// player class
var Player = (function() {
	function Player(uid_, name_) {
		this.uid = uid_;
		this.name = name_;
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
	}
	return Match; 
})();

server.sockets.on("connection", function(socket) {
	socket.on("msg", function(data){
		server.sockets.emit("broadcast", "serverMSG");
		socket.emit("msg", "serverMSG");
		console.log("incomig msg: " + data);
	});

	socket.on("disconnect", function() {
		//notify all clients that the player has dropped out
		server.sockets.emit("playerDisconnected", socket.player);

		//remove player from all matches he is currently registered in
		for( var matchIndex = 0; matchIndex < matches.length; matchIndex++ ) {
			var match = matches[matchIndex];
			console.log("match log: %j", match);
			for( var playerIndex = 0; playerIndex < match.players.length; playerIndex++ ) {
				var player = match.players[playerIndex];
				if( player === socket.player ) {
					match.players.splice(playerIndex, 1);
					console.log("removed player " + socket.player.uid + " from match \"" + match.title + "\"");
					break;
				}
			}
		}

		//remove player from current player list
		for( var i = 0; i < players.length; i++ ) {
			var player = players[i];
			if( player === socket.player ) {
				players.slice(i, 1);
				break;
			}	
		}

		console.log("player disconnected: %j ", socket.player);
		
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
		console.log("signed in player: %j", player);
	});
	
	//request new match
	socket.on("createMatch", function(data) {
		console.log("createMatch: %j ", data);
		if(socket.player === 'undefined') {
			console.log("ERROR: player not bound to socket!");
		}

		console.log("match request from player: " + socket.player.uid);
		
		//parse user input
		var matchData = data;
		var title = matchData.title;
		var secondsPerRound = matchData.secondsPerRound;
		var numRounds = matchData.numRounds;

		//create new match object
		var newMatch = new Match(title, secondsPerRound, numRounds);
		matches.push(newMatch);

		//add player to match
		newMatch.players.push(socket.player);

		socket.emit("newMatchCreated", JSON.stringify(newMatch));
		console.log("new match created: %j ", newMatch);
	});

	socket.on("ping", function( data ) {	
		console.log("PING with data: " + data);
		socket.emit("pingBack", matches.length);
	});
});
