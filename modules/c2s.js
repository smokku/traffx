const debug = require('debug')('medium:c2s')

function C2S (opts = {}) {
  this.opts = opts
  this.server = opts.server
  this.router = opts.router
  this.log = opts.log.child({ module: 'c2s' })

  this.server.on('listening', () => {
    let address = this.server.server.address()
    this.log.info(
      {
        address: address.address,
        port: address.port,
        sasl: this.server.availableSaslMechanisms.map(mech => mech.id).join(','),
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
      cb(null, opts)
    })

    client.on('online', () => {
      this.log.info({ client_id: client.id, client_jid: client.jid }, 'ONLINE')
      this.router.registerRoute(client.jid, client)
      this.router.registerRoute(client.jid.bare(), client)
      this.router.registerRoute(client.jid.domain, client)
    })

    client.on('stanza', stanza => {
      debug('%s %s STANZA %s', client.id, client.jid, stanza)
      // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      if (
        stanza.is('presence', 'jabber:client') &&
          [ 'subscribe', 'subscribed', 'unsubscribe', 'unsubscribed' ].includes(
            stanza.attrs.type
          )
      ) {
        stanza.attr('from', client.jid.bare().toString())
      } else {
        stanza.attr('from', client.jid.toString())
      }
      this.router.process(stanza)
    })

    client.on('disconnect', err => {
      this.log.info(
        { client_id: client.id, client_jid: client.jid },
        err ? `TEARDOWN ${err}` : 'DISCONNECT'
      )
      if (client.jid) {
        this.router.unregisterRoute(client.jid, client)
        this.router.unregisterRoute(client.jid.bare(), client)
        this.router.unregisterRoute(client.jid.domain, client)
      }
    })
  })
}

module.exports = C2S
