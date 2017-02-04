'use strict'
const debug = require('debug')('medium:main')
const xmpp = require('node-xmpp-server')

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
    '[%s]:%s CONNECT [%s]:%s => [%s]:%s',
    address.address,
    address.port,
    socket.remoteAddress,
    socket.remotePort,
    local.address,
    local.port
  )

  client.id = socket.remoteAddress + '/' + socket.remotePort

  client.on('authenticate', (opts, cb) => {
    debug('%s AUTHENTICATE', opts.client.id, opts.username, opts.password)
    cb(null, opts)
  })

  client.on('online', () => {
    debug('%s ONLINE', client.id, client.jid.toString())
  })

  client.on('stanza', stanza => {
    debug('%s %s STANZA', client.id, client.jid, stanza.toString())
    var from = stanza.attrs.from
    stanza.attrs.from = stanza.attrs.to
    stanza.attrs.to = from
    client.send(stanza)
  })

  client.on('disconnect', err => {
    debug(
      '%s %s %s',
      client.id,
      client.jid,
      err ? 'TEARDOWN ' + err : 'DISCONNECT'
    )
  })
})
// xmpp.C2S.prototype.route = function (stanza) {
//   var self = this
//   if (stanza.attrs && stanza.attrs.to) {
//     var toJid = new xmpp.JID(stanza.attrs.to)
//     redispub.publish(toJid.bare().toString(), stanza.toString())
//   }
// }
//
// xmpp.C2S.prototype.registerRoute = function (jid, client) {
//   redissub.subscribeTo(jid.bare().toString(), function (
//     channel,
//     stanza,
//     pattern
//   ) {
//     client.send(stanza)
//   })
//   return true
// }
