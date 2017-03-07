const debug = require('debug')('medium:c2s')
const junction = require('junction')

function C2S (opts = {}) {
  this.opts = opts
  this.server = opts.server
  this.router = opts.router
  this.log = opts.log.child({ module: 'c2s' })

  this.dumpExceptions = opts.dumpExceptions != null
    ? opts.dumpExceptions
    : true

  var outbound = this.outbound = junction()
  if (process.env.DEBUG) {
    outbound.use(require('./logger')({ prefix: 'C2S: ', logger: debug }))
  }
  var route = (stanza, next) => {
    opts.router.process(stanza)
  }
  outbound
    .use(require('./presence').outbound(this))
    .use(route)
    .use(junction.errorHandler({ dumpExceptions: this.dumpExceptions }))

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
      // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      // XMPP-IM case is handled in presence module
      stanza.attr('from', client.jid.toString())
      const response = this.router.makeResponse(client.jid, stanza)
      response.send = function () {
        client.send(this)
      }
      this.outbound.handle(stanza, response, err => {
        if (err) {
          this.log.error({ client_id: client.id, client_jid: client.jid, err })
        }
      })
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
