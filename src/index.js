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
const nodeHtmlToImage = require('node-html-to-image')
const { application } = require('express')
const { allowedNodeEnvironmentFlags } = require('process')

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

app.get('/capture/:source/:resolution', async (req, res) => {
    // OBS capture source formatter
    const captureSources = {
        pc: '*** AverMedia Live Gamer 4K Device',
        console: '*** AverMedia Live Gamer HD Device'
    }

    const resolutions = {
        '480p': { game: '>>> 480p', capture: '*** Game Capture Device - 480p' },
        '1080p': { game: '>>> 1080p', capture: '*** Game Capture Device - 1080p' }
    }
    
    if(['pc', 'console'].includes(req.params.source) && ['480p', '1080p'].includes(req.params.resolution) && (req.query.left || req.query.right || req.query.top || req.query.bottom)) {
        obs.call('GetSceneItemId', {
            sceneName: resolutions[req.params.resolution].game,
            sourceName: resolutions[req.params.resolution].capture,
        }).then((response) => {
            Promise.all([
                obs.call('GetSceneItemId', {
                    sceneName: resolutions[req.params.resolution].capture,
                    sourceName: '*** AverMedia Live Gamer 4K Device'
                }).then((r) => {
                    obs.call('SetSceneItemEnabled', {
                        sceneName: resolutions[req.params.resolution].capture,
                        sceneItemId: r.sceneItemId,
                        sceneItemEnabled: captureSources[req.params.source] === '*** AverMedia Live Gamer 4K Device' ? true : false
                    })    
                }).catch((err) => { 
                    logger.error(err.message)
                    logger.debug(err.stack)
                })
            ],
            [
                obs.call('GetSceneItemId', {
                    sceneName: resolutions[req.params.resolution].capture,
                    sourceName: '*** AverMedia Live Gamer HD Device'
                }).then((r) => {
                    obs.call('SetSceneItemEnabled', {
                        sceneName: resolutions[req.params.resolution].capture,
                        sceneItemId: r.sceneItemId,
                        sceneItemEnabled: captureSources[req.params.source] === '*** AverMedia Live Gamer HD Device' ? true : false
                    })    
                }).catch((err) => { 
                    logger.error(err.message)
                    logger.debug(err.stack)
                })
            ],
            [
                obs.call('SetSceneItemTransform', {
                    sceneName: resolutions[req.params.resolution].game,
                    sceneItemId: response.sceneItemId,
                    sceneItemTransform: {
                        cropTop: Number(req.query.top),
                        cropLeft: Number(req.query.left),
                        cropRight: Number(req.query.right),
                        cropBottom: Number(req.query.bottom)
                    }
                }).catch((err) => { 
                    logger.error(err.message)
                    logger.debug(err.stack)
                })
            ]).then(() => {
                res.status(200).json({ status: 200, message: 'OK'})
            }).catch((err) => {
                res.status(503).json({ status: 503, message: 'Service Unavailable', error: err.message })
            })
        }).catch((err) => {
            res.status(500).json({ status: 500, message: 'Internal Service Error'})
        })        
    } else {
        res.status(400).json({ status: 400, message: 'Bad Request' })
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
            logger.error(err.status)
            logger.debug(err.stack)
            res.status(500).json({ status: 500, message: 'Internal Server Error'})
        })
    } else {
        res.status(400).send('400 Bad Request')
    }
})

app.all('*', (req, res) => {
    // 404 catch-all
    res.status(404).json({ status: 404, message: 'Not Found' })
})

const httpServer = http.createServer(app)
httpServer.listen(8008)