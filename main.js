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
// const r = new xmpp.Router()
// pull packets off router, check validity (proper from, to in serviced domain)
// pass them to application
//
// pull packets from c2s, check validity (replace from with full jid, remove to if self bare jid)
// pass them to application
//
// application build chain similar to what jabberd2 has
//
// chain local delivery through redis message queues at the end of app
//
// pull packets from queues and pass through app
