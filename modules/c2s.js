const debug = require('debug')('medium:c2s')
const xmpp = require('node-xmpp-server')
const redis = require('redis-node')
const redispub = redis.createClient()
const redissub = redis.createClient()

function C2S (opts = {}) {
  this.opts = opts
  this.server = opts.server

  this.server.on('listening', () => {
    let address = this.server.server.address()
    debug(
      '[%s]:%s LISTENING C2S',
      address.address,
      address.port,
      this.server.availableSaslMechanisms.map(mech => mech.id)
    )
  })

  this.server.on('connection', client => {
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
      this.server.registerRoute(client.jid, client)
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
      this.server.route(stanza.attrs.to, stanza)
    })

    client.on('disconnect', err => {
      debug(
        '%s %s %s',
        client.id,
        client.jid,
        err ? `TEARDOWN ${err}` : 'DISCONNECT'
      )
      this.server.unregisterRoute(client.jid)
    })
  })
}

module.exports = C2S

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
