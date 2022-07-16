# Stream Control Center
This repo contains a Frankenstein's Monster API (node/express.js) that cobbles together Stream Deck button actions (via BarRaider's API Ninja plugin), home automation (TP-Link Kasa), and remote control of OBS (via obs-websocket).

If you're a streamer with an interest in stream workflow automation in JavaScript, this repo might be interesting to you (though not straight out of the jar... this API is pretty bespoke and would require heavy changes before it would be useful to anyone else).

If you aren't a streamer, or you aren't interested in stream workflow automation, well, maybe there's still something here you'll find useful...

## What Does it Do?
The API serves four primary functions:

 - Control of a network-connected HDMI switch box via Stream Deck buttons
 - Control of TP-Link Kasa WiFi plugs 
 - Control of the transform settings on OBS Scene Items
 - Observation and response to the change of stream state (e.g. stream started, stream ended) in OBS

## Disclaimer
This code probably isn't fit for anything, and probably isn't a great example of best practices.  It's here to hopefully give people ideas, nothing more.  However, if you have recommendations on how things could be improved, feel free to drop a PR.