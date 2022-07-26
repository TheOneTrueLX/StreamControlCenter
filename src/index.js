require('dotenv').config()
const express = require('express')
const http = require('http')
const pino = require('pino')
const kasa = require('tplink-smarthome-api')
const axios = require('axios')
const OBSWebSocket = require('obs-websocket-js').default
const bodyparser = require('body-parser')
const net = require('net')
const path = require('path')
const ejs = require('ejs')
const fs = require('fs')
const { Server } = require('socket.io')
const nodeHtmlToImage = require('node-html-to-image')
const { application } = require('express')
const { allowedNodeEnvironmentFlags } = require('process')
const { ClientCredentialsAuthProvider } = require('@twurple/auth')
const sqlite3 = require('sqlite3')
const { ApiClient } = require('@twurple/api')
const { ChatClient } = require('@twurple/chat')

const app = express()

const logger = pino({
    transport: {
        target: 'pino-pretty'
    },
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
})

const kasaClient = new kasa.Client()
const obs = new OBSWebSocket()

const kasaDevices = [
    { name: "on-air light", ip: "192.168.1.196" },
    { name: "studio light", ip: "192.168.1.79" }
]

const kvmSwitch = { ip: '192.168.1.239', port: 5000 }

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

function obsConnect() {
    obs.connect(`ws://${process.env.OBS_WS_HOST}:${process.env.OBS_WS_PORT}`, process.env.OBS_WS_PASSWORD)
    .then((conn) => {
        logger.info(`Connected to OBS instance at ${process.env.OBS_WS_HOST}:${process.env.OBS_WS_PORT} - obs-websocket version ${conn.obsWebSocketVersion} (using RPC v${conn.negotiatedRpcVersion})`)
    }).catch((err) => {
        logger.error(`Failed to connect to OBS instance: ${err.message}.  Retrying in 5 seconds...`)
    })    
}

obs.addListener("StreamStateChanged", async (evt) => {
    const onAirLight = await kasaClient.getDevice({ host: kasaDevices.filter(p => p.name == "on-air light" )[0].ip })
    const studioLight = await kasaClient.getDevice({ host: kasaDevices.filter(p => p.name == "studio light" )[0].ip })
    switch(evt.outputState) {
        case 'OBS_WEBSOCKET_OUTPUT_STARTED':
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

obs.on('ConnectionClosed', () => {
    setTimeout(obsConnect, 5000)
})

// Initial OBS connection
setTimeout(obsConnect, 5000)

app.use(bodyparser.json())
app.use(bodyparser.urlencoded({ extended: false }))

// Set up HTML templating
app.engine('.html', ejs.__express)
app.set('views', path.join(__dirname, 'views'))
app.use('/public', express.static(path.join(__dirname, 'public')))

app.set('view engine', 'html')

app.use((err, req, res, next) => {
    logger.error(err.message)
    logger.debug(err.stack)
    res.status(500).json({ status: 500, message: `An error occurred: ${err.message}`})
})

app.get('/', (req, res) => {
    res.status(200).json({ application: 'StreamControlCenter', version: '1.0.0' })
})

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

app.get('/kvm', async (req, res) => {

    if(req.query.port) {
        const kvmControl = new Uint8Array([
            170, // 0xAA
            187, // 0xBB
            3,   // 0x03
            1,   // 0x01
            parseInt(req.query.port),  // integer within the range 1 through 16
            238  // 0xEE
        ])

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

app.get('/finetune/:direction/:operation', async (req, res) => {
    try {
        const { sceneItemId: cropSourceId } = await obs.call('GetSceneItemId', { sceneName: crop.scene, sourceName: crop.source })
        const { sceneItemTransform: cropTransform } = await obs.call('GetSceneItemTransform', { sceneName: crop.scene, sceneItemId: cropSourceId })
    
        
        if(['top', 'left', 'bottom', 'right'].includes(req.params.direction) && ['increment', 'decrement'].includes(req.params.operation)) {

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

app.get('/gentweet', async (req, res) => {
    if(req.query.url) {
    
        const tweet = /https\:\/\/twitter.com\/.*\/status\/(.*)/.exec(req.query.url)
        const html = await ejs.renderFile(path.join(__dirname, 'views', 'tweet.html'), {
            tweetid: tweet[1]
        })
        // 564 x 560
        await nodeHtmlToImage({
            output: path.join(__dirname, 'public', 'tweet.png'),
            html: html,
            transparent: true,
            waitUntil: 'networkidle0',
            selector: '#tweetContainer'
        }).then(() => {
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

const authProvider = new ClientCredentialsAuthProvider(process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET)
const apiClient = new ApiClient({ authProvider })

app.get('/shoutout', async (req, res) => {
    const broadcaster = await apiClient.users.getUserByName(req.query.broadcaster)
    const clip = await apiClient.clips.getClipsForBroadcaster(broadcaster, { limit: 5 })
    const randomClip = Math.floor(Math.random() * 5) + 1

    res.status(200).json({ 
        embed_url: clip.data.length > 0 ? clip.data[randomClip - 1].embedUrl : null,
        broadcaster: broadcaster.displayName,
        profile_img: broadcaster.profilePictureUrl,
        duration: clip.data.length > 0 ? clip.data[randomClip - 1].duration : null
    })
})

const chatClient = new ChatClient({ channels: ['theonetruelx'] })

app.get('/chatoverlay', (req, res) => {
    if(!chatClient.isConnected) {
        logger.info('Connecting to Twitch chat...')
        setTimeout(twitchChatConnect, 5000)
    }
    res.status(200).render('chat')
})

app.all('*', (req, res) => {
    // 404 catch-all
    res.status(404).json({ status: 404, message: 'Not Found' })
})

const httpServer = http.createServer(app)
const io = new Server(httpServer)

// the docs allege that by not passing an authProvider, the 
// chat client 

function twitchChatConnect() {
    chatClient.connect().then(() => {
        logger.info('Connected to Twitch chat channel #theonetruelx')
    }).catch((err) => {
        logger.error(err.message)
        logger.debug(err.stack)
    })
}

chatClient.onDisconnect((manually, reason) => {
    if(!manually) {
        logger.error(`Disconnected from Twitch chat... reconnecting in 5 seconds...`)
        setTimeout(twitchChatConnect, 5000)
    } else {
        logger.warn('Disconnecting from Twitch Chat (expected)')
    }
})

io.on('connection', (socket) => {
    logger.info('[socket.io] chat overlay connected')

    chatClient.onMessage(async (channel, user, message, msg) => {
        // check for cached chat user record
        db.get('SELECT * FROM user_cache WHERE username=$username', {
            $username: user
        }, async (err, row) => {

            if(err) {
                logger.error(err.message)
                logger.debug(err.stack)
            }
            
            if(!row) {
                // if we got here, the chat user isn't cached.  We cache it here.
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
        // TODO: we might be able to make this more selective
        // see: https://socket.io/docs/v4/server-api/#event-disconnect
        chatClient.quit()
    })
})

httpServer.listen(8008)