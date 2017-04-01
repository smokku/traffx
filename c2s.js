// eslint-disable-next-line no-unused-vars
const debug = require('debug')('traffic:c2s')
const xmpp = require('node-xmpp-core')
const NS = require('./ns')
const Direct = require('./models/direct')

function C2S (opts = {}) {
  this.opts = opts
  this.server = opts.server
  this.router = opts.router
  this.log = opts.log.child({ module: 'c2s' })

  this.dumpExceptions = opts.dumpExceptions != null
    ? opts.dumpExceptions
    : true

  // https://github.com/node-xmpp/node-xmpp/issues/391
  var streamFeatures = (this.streamFeatures = {})
  function sendFeatures () {
    if (this.authenticated) {
      const features = new xmpp.Element('stream:features', {
        xmlns: NS.STREAMS,
        'xmlns:stream': NS.STREAMS
      })
      features.c('bind', { xmlns: NS.BIND })
      features.c('session', { xmlns: NS.SESSION })
      for (const name of Object.keys(streamFeatures)) {
        features.c(name, { xmlns: streamFeatures[name] })
      }
      this.send(features)
    } else {
      this.constructor.prototype.sendFeatures.apply(this)
    }
  }

  Object.assign(
    this.streamFeatures,
    require('./modules/subscription').streamFeatures
  )

  this.server.on('listening', () => {
    const address = this.server.server.address()
    this.log.info(
      {
        address: address.address,
        port: address.port,
        sasl: this.server.availableSaslMechanisms
          .map(mech => mech.id)
          .join(','),
        server: this.server.constructor.name
      },
      'LISTENING'
    )
  })

  this.server.on('connection', client => {
    const address = client.server.server.address()
    const socket = client.server.WS
      ? client.connection.socket.socket._socket
      : client.connection.socket
    const local = socket.address()

    client.id = `${socket.remoteAddress}/${socket.remotePort}`
    client.sendFeatures = sendFeatures

    this.log.info(
      {
        client_id: client.id,
        address: address.address,
        port: address.port,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localAddress: local.address,
        localPort: local.port
      },
      'CONNECT'
    )

    client.on('authenticate', (opts, cb) => {
      this.log.info(
        {
          client_id: opts.client.id,
          username: opts.username,
          password: !!opts.password
        },
        'AUTH'
      )
      var auth
      if (process.env.TRAFFIC_AUTH) {
        auth = process.env.TRAFFIC_AUTH.replace('/', '')
      } else if (process.env.NODE_ENV === 'development') {
        auth = 'dummy'
      } else {
        throw new Error('No TRAFFIC_AUTH module selected')
      }
      require(`./auth/${auth}`)(opts, cb)
    })

    client.on('online', () => {
      this.log.info({ client_id: client.id, client_jid: client.jid }, 'ONLINE')
      this.router.registerRoute(client.jid, client)
      this.router.registerRoute(client.jid.bare(), client)
      this.router.registerRoute(client.jid.domain, client)
    })

    client.on('stanza', stanza => {
      if (typeof stanza.type === 'undefined') {
        // C2S WebSocket connector passes ltx.Element not Stanza - reparse it
        // https://github.com/node-xmpp/node-xmpp/issues/390
        stanza = xmpp.parse(stanza.toString())
      }
      // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      // XMPP-IM case is handled in presence module
      stanza.attr('from', client.jid.toString())

      this.router.handle(client, stanza)
    })

    client.on('end', err => {
      this.log.info(
        { client_id: client.id, client_jid: client.jid },
        err ? `TEARDOWN ${err}` : 'DISCONNECT'
      )
      if (client.jid) {
        this.router.unregisterRoute(client.jid, client)
        this.router.unregisterRoute(client.jid.bare(), client)
        this.router.unregisterRoute(client.jid.domain, client)
        // https://xmpp.org/rfcs/rfc6121.html#presence-unavailable-outbound
        // If the server detects that the user has gone offline ungracefully, then the server
        // MUST generate the unavailable presence broadcast on the user's behalf.
        if (client.session) {
          this.router.handle(
            client,
            new xmpp.Presence({
              type: 'unavailable',
              from: client.jid.toString()
            })
          )
        } else {
          // https://xmpp.org/rfcs/rfc6121.html#presence-directed-considerations
          // clearing the list when the user goes offline (e.g., by sending a broadcast presence stanza of type "unavailable")
          Direct.clear(client.jid.toString()).catch(err => {
            this.log.console.error(
              { client_id: client.id, client_jid: client.jid },
              err
            )
          })
        }
      }
    })
  })
}

module.exports = C2S
