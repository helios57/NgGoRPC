module github.com/nggorpc/example/server

go 1.26.0

require (
	github.com/helios57/NgGoRPC/wsgrpc v0.0.0
	google.golang.org/grpc v1.81.1
)

replace github.com/helios57/NgGoRPC/wsgrpc => ../../wsgrpc

require (
	github.com/coder/websocket v1.8.15 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/text v0.38.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260622175928-b703f567277d // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
