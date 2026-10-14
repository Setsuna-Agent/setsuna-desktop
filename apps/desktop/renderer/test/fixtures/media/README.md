`sample.mp4` is a synthetic three-second, 64×64 H.264 gradient animation with no
audio or user data, generated with macOS AVAssetWriter. The offline Electron test
uses the production format classifier, preload, IPC, streaming server and video
component to check decoding, playback, seeking and URL release on close. It makes
no appearance assertions and takes no screenshots. The fixture is checked in;
running the test does not require an encoder.
