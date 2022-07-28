require('dotenv').config()
const express = require('express')
const http = require('http')
const pino = require('pino')
const kasa = require('tplink-smarthome-api')
const OBSWebSocket = require('obs-websocket-js').default
const bodyparser = require('body-parser')
const net = require('net')
const path = require('path')
// ^-- this was where we started

const ejs = require('ejs')
const { Server } = require('socket.io')
const nodeHtmlToImage = require('node-html-to-image')
const { ClientCredentialsAuthProvider } = require('@twurple/auth')
const sqlite3 = require('sqlite3')
const { ApiClient } = require('@twurple/api')
const { ChatClient } = require('@twurple/chat')
// ^-- and somehow it grew to this

const app = express()

const logger = pino({
    transport: {
        target: 'pino-pretty'
    },
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
})

// create global instances of kasa and obs-websocket clients
const kasaClient = new kasa.Client()
const obs = new OBSWebSocket()

// right now this script only works with TP-Link Kasa wifi outlets, but
// it wouldn't be hard to support other home automation platforms
const kasaDevices = [
    { name: "on-air light", ip: "192.168.1.196" },
    { name: "studio light", ip: "192.168.1.79" }
]

// In case you're curious, this is a TESmart 16x1 HDMI switch
// Works surprisingly well with retro gear.
// https://www.amazon.com/gp/product/B085S1CR6T
const kvmSwitch = { ip: '192.168.1.239', port: 5000 }

// I don't want to make a call to the Twitch API every time 
// someone chats just to pull their profile image, so I use
// a basic SQLite database as a sort of local cache for
// chatter display name and profile pic URL.
const DBSOURCE = 'db.sqlite'
const db = new sqlite3.Database(DBSOURCE, (err) => {
    if(err) {
        logger.error(err.message)
        logger.debug(err.stack)
        throw err
    } else {
        db.run(`CREATE TABLE user_cache (
            username text,
            displayname text,
            profile_image_url text
        )`, (err) => {
            if(err) {
                logger.warn(`Detected existing user cache database`)               
            }
        })
    }
})

// This function initiates the connection to the obs-websocket server.
// I created a function for this so that I could more easily wrap it
// with setTimeout() to implement a sort of rudimentary connection retry
// system.
function obsConnect() {
    obs.connect(`ws://${process.env.OBS_WS_HOST}:${process.env.OBS_WS_PORT}`, process.env.OBS_WS_PASSWORD)
    .then((conn) => {
        logger.info(`Connected to OBS instance at ${process.env.OBS_WS_HOST}:${process.env.OBS_WS_PORT} - obs-websocket version ${conn.obsWebSocketVersion} (using RPC v${conn.negotiatedRpcVersion})`)
    }).catch((err) => {
        logger.error(`Failed to connect to OBS instance: ${err.message}.  Retrying in 5 seconds...`)
    })    
}

// handles automatic power state change of studio and on-air light based
// on stream state (e.g stream started, stream ended)
obs.addListener("StreamStateChanged", async (evt) => {
    // set up device references in the Kasa client.  The whole array filtering seems
    // like a lot of extra work just to pass an IP address to the client, but now
    // I only need to change those IPs in one place in the script.
    const onAirLight = await kasaClient.getDevice({ host: kasaDevices.filter(p => p.name == "on-air light" )[0].ip })
    const studioLight = await kasaClient.getDevice({ host: kasaDevices.filter(p => p.name == "studio light" )[0].ip })
    switch(evt.outputState) {
        case 'OBS_WEBSOCKET_OUTPUT_STARTED':
            // this event fires whenever I push the "start stream"
            // button in OBS, which turns on my studio lights above my desk and
            // the "on-air" light outside my office door.
            onAirLight.setPowerState(true).then(() => {
                logger.info('On-Air Light turned on.')
            }).catch((err) => {
                logger.error(`Unable to turn on On-Air Light: ${err.message}`)
            })
            studioLight.setPowerState(true).then(() => {
                logger.info('Studio Light turned on.')
            }).catch((err) => {
                logger.error(`Unable to turn on Studio Light: ${err.message}`)
            })
            break;
        
        case 'OBS_WEBSOCKET_OUTPUT_STOPPED':
            // This event fires whenever I push the "stop stream" button
            // in OBS, and turns off the aforementioned lights.
            onAirLight.setPowerState(false).then(() => {
                logger.info('On-Air Light turned on.')
            }).catch((err) => {
                logger.error(`Unable to turn on On-Air Light: ${err.message}`)
            })
            studioLight.setPowerState(false).then(() => {
                logger.info('Studio Light turned on.')
            }).catch((err) => {
                logger.error(`Unable to turn on Studio Light: ${err.message}`)
            })
            break;
    }
})


// If the obs-websocket client catches an unexpected connection closure, it will
// attempt to reconnect.
obs.on('ConnectionClosed', () => {
    // TODO: this could probably be handled more gracefully by checking
    // for a reason code instead of just ignoring the event payload entirely
    setTimeout(obsConnect, 5000)
})

// Handles the initial connection to obs-websocket.  This will retry the connection 
// roughly every 5 seconds (plus whatever the connection timeout setting is for the
// obs-websocket client, which I never bothered to check)
setTimeout(obsConnect, 5000)

// finally getting to some of the boilerplate express.js setup
app.use(bodyparser.json())
app.use(bodyparser.urlencoded({ extended: false }))

// Set up EJS HTML templating
app.engine('.html', ejs.__express)
app.set('views', path.join(__dirname, 'views'))
app.use('/public', express.static(path.join(__dirname, 'public')))

app.set('view engine', 'html')

// error handler middleware
app.use((err, req, res, next) => {
    logger.error(err.message)
    logger.debug(err.stack)
    res.status(500).json({ status: 500, message: `An error occurred: ${err.message}`})
})

// this endpoint just displays some basic app information
app.get('/', (req, res) => {
    res.status(200).json({ application: 'StreamControlCenter', version: '1.0.0' })
})

// This endpoint allows me to directly turn on/off the Kasa outlets.
// Unused right now, but this would potentially let me bind the lights
// to a button on my streamdeck if I wanted to.
app.get('/lights', async (req, res) => {
    if(req.query.device) {
        const device = await kasaClient.getDevice({ host: kasaDevices.filter(p => p.name == req.query.device )[0].ip })
        const state = await device.getPowerState()
        await device.setPowerState(!state)
        
        res.status(200).json({ status: 200, message: 'OK', data: { device: req.query.device, state: !state ? 'on' : 'off' } })
    } else {
        res.status(400).json({ status: 400, message: 'Bad Request' })
    }
})

// This endpoint controls my KVM
app.get('/kvm', async (req, res) => {

    if(req.query.port) {
        // this byte array is the control code which tells
        // the KVM to switch to a specific port
        const kvmControl = new Uint8Array([
            170, // 0xAA
            187, // 0xBB
            3,   // 0x03
            1,   // 0x01
            parseInt(req.query.port),  // integer within the range 1 through 16
            238  // 0xEE
        ])

        // no helper modules for this... we're raw-dogging the socket here...
        var kvm = net.connect({ port: kvmSwitch.port, host: kvmSwitch.ip })
        const success = kvm.write(kvmControl)
        if(success === true) {
            res.status(200).json({ status: 200, message: 'OK' })
        } else {
            res.status(503).json({ status: 503, message: 'Service Unavailable'})
        }
    } else {
        res.status(400).json({ status: 400, message: 'Bad Request' })
    }
})

/* 
This is the point in time where I started to say 
"wouldn't be cool if this API could also...", 
as reflected by the increasingly discorganized code.
*/


/*
Ok, I need to explain this next chunk of code...

I have 14 consoles hooked up that I can stream from.  Each one requires some form of fine-tuning
in OBS in order to preserve the aspect ratio, prevent letterboxing, remove unwanted overscan,
etc. (the common pleasantries of analogue to digital conversion).

This next endpoint handles the adjustment of the transform settings for the capture source 
in OBS.  Combined with the KVM controls above, this basically takes five or six tedious steps 
and condenses them into a single button-press on my stream deck.

*/

// these names need to exactly match the scene/source
// names in OBS (case sensitive)
const crop = {
    scene: '*** Game Capture',
    source: '*** Game Capture Devices'
}

const capture = {
    pc: '*** AverMedia Live Gamer 4K Device',
    console: '*** AverMedia Live Gamer HD Device'
}

app.get('/capture/:source', async (req, res) => {
    // OBS capture source formatter
    try {
        if(['pc', 'console'].includes(req.params.source) && (req.query.left || req.query.right || req.query.top || req.query.bottom)) {
            
            // Step 1: get the scene ID for the game capture devices source
            const { sceneItemId: cropSourceId } = await obs.call('GetSceneItemId', { sceneName: crop.scene, sourceName: crop.source})

            // Step 2: iterate through the capture object and toggle the scene items visible/invisible
            // based on the source param passed in the URL
            const { sceneItemId: pcSourceId } = await obs.call('GetSceneItemId', { sceneName: crop.source, sourceName: capture.pc })
            await obs.call('SetSceneItemEnabled', { sceneName: crop.source, sceneItemId: pcSourceId, sceneItemEnabled: req.params.source === "pc" ? true : false })

            const { sceneItemId: consoleSourceId } = await obs.call('GetSceneItemId', { sceneName: crop.source, sourceName: capture.console })
            await obs.call('SetSceneItemEnabled', { sceneName: crop.source, sceneItemId: consoleSourceId, sceneItemEnabled: req.params.source === "console" ? true : false })
 
            // Step 3: adjust the transform settings on the crop source sceneitem
            await obs.call('SetSceneItemTransform', { 
                sceneName: crop.scene,
                sceneItemId: cropSourceId,
                sceneItemTransform: {
                    cropTop: Number(req.query.top) || 0,
                    cropBottom: Number(req.query.bottom) || 0,
                    cropLeft: Number(req.query.left) || 0,
                    cropRight: Number(req.query.right) || 0
                }
            })
    
            res.status(200).json({ status: 200, message: 'OK' })
       
        } else {
            res.status(400).json({ status: 400, message: 'Bad Request' })
        }    
    } catch (err) {
        logger.error(err.message)
        logger.debug(err.stack)
        res.status(500).json({ status: 500, message: 'Internal Service Error'})
    }
})

// I haven't implemented or even tested this yet, but this endpoint will allow
// me to fine-tune the capture source cropping settings on-the-fly
app.get('/finetune/:direction/:operation', async (req, res) => {
    try {
        const { sceneItemId: cropSourceId } = await obs.call('GetSceneItemId', { sceneName: crop.scene, sourceName: crop.source })
        const { sceneItemTransform: cropTransform } = await obs.call('GetSceneItemTransform', { sceneName: crop.scene, sceneItemId: cropSourceId })
    
        // I think this might be the only place in this whole app where I even attempt to do any sort of input validation
        if(['top', 'left', 'bottom', 'right'].includes(req.params.direction) && ['increment', 'decrement'].includes(req.params.operation)) {

            // this is the javascript equivalent of juggling white-hot saw blades
            var newVal = cropTransform[ 'crop' + String(req.params.direction).charAt(0).toUpperCase() ]
            switch(req.params.operation) {
                case 'increment':
                    newVal++
                    break
                
                case 'decrement':
                    newVal--
                    break
            }

            await obs.call('SetSceneItemTransform', {
                sceneName: crop.scene,
                sceneItemId: cropSourceId,
                sceneItemTransform: {
                    [ 'crop' + String(req.params.direction).charAt(0).toUpperCase() ]: newVal
                }
            })

            res.status(200).json({ status: 200, message: 'OK' })

        } else {
            res.status(400).json({ status: 400, message: 'Bad Request' })
        }

    } catch (err) {
        logger.error(err.message)
        logger.debug(err.stack)
        res.status(500).json({ status: 500, message: 'Internal Server Error' })
    }
})

// This stupid little endpoint extracts a tweet ID from a twitter URL,
// then displays that tweet using Twitter's oEmbed API 
// ref: https://developer.twitter.com/en/docs/twitter-for-websites/timelines/guides/oembed-api

// this endpoint isn't really used anymore apart from testing
app.get('/tweet', async (req, res) => {
    if(req.query.url) {
        const tweet = /https\:\/\/twitter.com\/.*\/status\/(.*)/.exec(req.query.url)
        res.status(200).render('tweet', {
            tweetid: tweet[1]
        })
    } else {
        res.status(400).send('400 Bad Request')
    }
})

// There's a lot going on here...  just read the inline comments.
// tl;dr I wanted a way where I could display a tweet in a browser source, but
// using the Twitch oEmbed API directly in a Mixitup bot overlay widget was 
// inconsistent at best.  With this method, all I need to do from Mixitup is
// display an image.
app.get('/gentweet', async (req, res) => {
    if(req.query.url) {
    
        // get the tweet ID from a twitter URL passed from the query string
        const tweet = /https\:\/\/twitter.com\/.*\/status\/(.*)/.exec(req.query.url)

        // instead of displaying HTML to the browser, this compiles and saves the
        // parsed HTML template to a variable
        const html = await ejs.renderFile(path.join(__dirname, 'views', 'tweet.html'), {
            tweetid: tweet[1]
        })
        
        // it then takes that HTML and converts it to an image
        await nodeHtmlToImage({
            output: path.join(__dirname, 'public', 'tweet.png'),
            html: html,
            transparent: true,
            waitUntil: 'networkidle0',
            selector: '#tweetContainer'
        }).then(() => {
            // if all goes well, that image can be viewed at http://localhost:8008/public/tweet.png
            logger.info(`Successfully generated image for Tweet #${tweet[1]}`)
            res.status(200).json({ status: 200, message: 'OK' })
        }).catch((err) => {
            logger.error(err)
            res.status(500).json({ status: 500, message: 'Internal Server Error', error: err})
        })
    } else {
        res.status(400).send('400 Bad Request')
    }
})

/* This is the point where I really started going apeshit */

const authProvider = new ClientCredentialsAuthProvider(process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET)
const apiClient = new ApiClient({ authProvider })

// Just ignore this.  I'm not using it and it'll be going away soon.
app.get('/shoutout', async (req, res) => {
    try{ 
        const broadcaster = await apiClient.users.getUserByName(req.query.broadcaster)
        if(broadcaster) {

            const clip = await apiClient.clips.getClipsForBroadcaster(broadcaster, { limit: 5 })
            const randomClip = Math.floor(Math.random() * 5) + 1

            io.sockets.emit('shoutout', {
                embed_url: clip.data.length > 0 ? clip.data[randomClip - 1].embedUrl : null,
                broadcaster: broadcaster.displayName,
                profile_img: broadcaster.profilePictureUrl,
                duration: clip.data.length > 0 ? clip.data[randomClip - 1].duration : null
            })
            res.status(200).json({ status: 200, message: 'OK'})
        } else {
            res.status(404).json({ status: 404, message: 'Not Found'})
        }
    } catch (err) {
        logger.error(err.message)
        logger.debug(err.stack)
        res.status(500).json({ status: 500, message: 'Internal Server Error'})
    }
})

const chatClient = new ChatClient({ channels: ['theonetruelx'] })

// renders the overlay page, which is intended to be used for chat, 
// shoutouts, and pretty much any other stupid ideas I may 
// come up with in the future
app.get('/overlay', (req, res) => {
    res.status(200).render('overlay', {
        align: req.query.align || 'left',
        nofade: req.query.nofade || "false",
        chattop: req.query.chattop || 0,
        chatleft: req.query.chatleft || 0,
        chatwidth: req.query.chatwidth || 1920,
        chatheight: req.query.chatheight || 1080,
        chatguide: req.query.chatguide || "false",
    })
})

app.all('*', (req, res) => {
    // 404 catch-all
    res.status(404).json({ status: 404, message: 'Not Found' })
})

const httpServer = http.createServer(app)
const io = new Server(httpServer)

// Helper function to connect to the Twitch chat API.
// The docs allege that by not passing an authProvider, the 
// chat client will connect to the correct channel anonymously,
// which it in fact does.
function twitchChatConnect() {
    chatClient.connect().then(() => {
        logger.info('Connected to Twitch chat channel #theonetruelx')
    }).catch((err) => {
        logger.error(err.message)
        logger.debug(err.stack)
    })
}

// If the connection to the Twitch chat API is disconnected, we try to determine
// if that disconnect was intentional.  If it wasn't, we attempt to reconnect.
chatClient.onDisconnect((manually, reason) => {
    if(!manually) {
        logger.error(`Disconnected from Twitch chat... reconnecting in 5 seconds...`)
        setTimeout(twitchChatConnect, 5000)
    } else {
        logger.warn('Successfully disconnected from Twitch chat')
    }
})

// This even fires on every new socket.io connection from the
// chat overlay page.
io.on('connection', (socket) => {
    logger.info('[socket.io] chat overlay connected')

    if(!chatClient.isConnected) {
        // set up a chat connection if there isn't one already.  In theory
        // this API should only connect to the Twitch chat API if there is
        // at least one active chat browser overlay session active.
        setTimeout(twitchChatConnect, 5000)
    }

    chatClient.onMessage(async (channel, user, message, msg) => {
        // read the input from the chat API and process the message.

        // first, let's check for a cached user in the database
        db.get('SELECT * FROM user_cache WHERE username=$username', {
            $username: user
        }, async (err, row) => {

            if(err) {
                // If things go tits-up, log it but don't rethrow.
                // We can still use the Twitch API as a fall-back.
                logger.error(err.message)
                logger.debug(err.stack)
            }
            
            if(!row) {
                // if we got this far, the chat user isn't cached, so
                // we'll insert a record containing the stuff we want to cache
                const twitchUser = await apiClient.users.getUserByName(user)
                db.run('INSERT INTO user_cache VALUES($username, $displayname, $profile_image_url)', {
                    $username: user,
                    $displayname: twitchUser.displayName,
                    $profile_image_url: twitchUser.profilePictureUrl
                })

                // emit the results from the Twitch API call to the chat overlay
                socket.emit('chatMsg', { user: twitchUser.displayName, profile: twitchUser.profile_img_url, message: message })
            } else {
                // emit the results from the database to the chat overlay
                socket.emit('chatMsg', { user: row.displayname, profile: row.profile_image_url, message: message})
            }   
        })
    })

    socket.on('disconnect', (reason) => {
        if(Object.keys(io.sockets.sockets).length === 0) {
            // If there are no longer any open sockets, we can close the
            // connection to chat.  In theory this check is slow enough that
            // it should be able to elegantly deal with rapid close/reopen of
            // the overlay page (though this won't be a problem if OBS is
            // configured not to close the browser session when the source
            // visibility changes)
            logger.warn('No active socket.io connections - disconnecting from Twitch chat')
            chatClient.quit()
        }
    })
})

// fire this fucker up and start listening for requests
httpServer.listen(8008)