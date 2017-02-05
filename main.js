'use strict'
const debug = require('debug')('medium:main')
const xmpp = require('node-xmpp-server')
const redis = require('redis-node')
const redispub = redis.createClient()
const redissub = redis.createClient()

xmpp._Server.prototype.route = function (jid = '', stanza) {
  redispub.publish(jid, stanza.toString())
}

xmpp._Server.prototype.registerRoute = function (jid, client) {
  redissub.subscribeTo(jid, (channel, stanza, pattern) => {
    client.send(stanza)
  })
  return true
}

xmpp._Server.prototype.unregisterRoute = function (jid, client) {
  redissub.unsubscribeFrom(jid)
  return true
}

// const r = new xmpp.Router()
const c2s = new xmpp.C2S.TCPServer()

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
c2s.on('listening', () => {
  let address = c2s.server.address()
  debug(
    '[%s]:%s LISTENING C2S',
    address.address,
    address.port,
    c2s.availableSaslMechanisms.map(mech => mech.id)
  )
})

c2s.on('connection', client => {
  let address = client.server.server.address()
  let socket = client.connection.socket
  let local = socket.address()
  debug(
    '[%s]:%s CONNECT [%s]:%s -> [%s]:%s',
    address.address,
    address.port,
    socket.remoteAddress,
    socket.remotePort,
    local.address,
    local.port
  )

  client.id = `${socket.remoteAddress}/${socket.remotePort}`

  client.on('authenticate', (opts, cb) => {
    debug('%s AUTH', opts.client.id, opts.username, opts.password)
    cb(null, opts)
  })

  client.on('online', () => {
    debug('%s ONLINE', client.id, client.jid.toString())
    c2s.registerRoute(client.jid, client)
  })

  client.on('stanza', stanza => {
    debug('%s %s STANZA', client.id, client.jid, stanza.toString())
    // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
    if (
      stanza.is('presence', 'jabber:client') &&
        [ 'subscribe', 'subscribed', 'unsubscribe', 'unsubscribed' ].includes(
          stanza.type
        )
    ) {
      stanza.from = client.jid.bare().toString()
    } else {
      stanza.from = client.jid.toString()
    }
    c2s.route(stanza.attrs.to, stanza)
  })

  client.on('disconnect', err => {
    debug(
      '%s %s %s',
      client.id,
      client.jid,
      err ? `TEARDOWN ${err}` : 'DISCONNECT'
    )
    c2s.unregisterRoute(client.jid)
  })
})
