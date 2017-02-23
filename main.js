'use strict'
const debug = require('debug')('medium:main')
const xmpp = require('node-xmpp-server')

if (process.env.NODE_ENV === 'development') {
  var dynalite = require('dynalite')({path: './serverdb', createTableMs: 50})
  dynalite.listen(4567, err => {
    if (err) console.error(err)
  })
}

const s2s = new xmpp.Router()
const Router = require('./modules/router')
const router = new Router({ router: s2s })
// FIXME https://github.com/node-xmpp/node-xmpp/issues/366
const DomainContext = require('node-xmpp-server/lib/S2S/domaincontext')
DomainContext.prototype.receive = function (stanza) {
  debug('router receive %s', stanza)
  // https://xmpp.org/rfcs/rfc6120.html#stanzas-attributes
  if (stanza.attrs.to && stanza.attrs.from) {
    if (stanza.attrs.xmlns === 'jabber:server') {
      stanza.attrs.xmlns = 'jabber:client'
    }
    router.process(stanza, true)
  }
}

const C2S = require('./modules/c2s')
const tcp = new C2S({ server: new xmpp.C2S.TCPServer(), router })
const ws = new C2S({ server: new xmpp.C2S.WebSocketServer(), router })

s2s._server.on('listening', () => {
  debug('ONLINE', s2s.constructor.name)
})

tcp.server.on('online', () => {
  debug('ONLINE', tcp.server.constructor.name)
})

ws.server.on('online', () => {
  debug('ONLINE', ws.server.constructor.name)
})
