module github.com/nggorpc/example/server

go 1.24.0

require github.com/nggorpc/wsgrpc v0.0.0

require (
	golang.org/x/net v0.47.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
	golang.org/x/text v0.31.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/grpc v1.77.0 // indirect
	google.golang.org/protobuf v1.36.10 // indirect
	nhooyr.io/websocket v1.8.10 // indirect
)

replace github.com/nggorpc/wsgrpc => ../../wsgrpc
