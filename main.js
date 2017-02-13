'use strict'
const debug = require('debug')('medium:main')
const xmpp = require('node-xmpp-server')

const Router = require('./modules/router')
const router = new Router()

const C2S = require('./modules/c2s')
const tcp = new C2S({ server: new xmpp.C2S.TCPServer(), router })
const ws = new C2S({ server: new xmpp.C2S.WebSocketServer(), router })

tcp.server.on('online', () => {
  debug('ONLINE', tcp.server.constructor.name)
})

ws.server.on('online', () => {
  debug('ONLINE', ws.server.constructor.name)
})
