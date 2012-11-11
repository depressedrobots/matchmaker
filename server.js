var io = require("socket.io");
var server = io.listen(1337).set("log level", 1);

var matches = [];

server.sockets.on("connection", function(socket) {
	socket.on("msg", function(data){
		server.sockets.emit("broadcast", "serverMSG");
		socket.emit("msg", "serverMSG");
		console.log("incomig msg: " + data);
	});
	socket.on("createMatch", function(data) {
		console.log("create match: "+ data);
	});

	socket.on("ping", function( data ) {	
		console.log("PING with data: " + data);
		socket.emit("pingBack", matches.length);
	});
});
