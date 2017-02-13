const debug = require('debug')('medium:router')
const redis = require('redis')
const xmpp = require('node-xmpp-core')
const EventEmitter = require('events')
const junction = require('junction')

function Router (opts = {}) {
  this.opts = opts
  this.redis = opts.redis || redis.createClient()
  this.redsub = opts.redsub || redis.createClient()
  this._channelEmitter = new EventEmitter()
  this.redsub.on('message', this.onMessage.bind(this))
  this.server = junction()
  this.user = junction()

  // process packet to server
  if (process.env.DEBUG) {
    this.server.use(junction.dump({ prefix: 'SERVER: ' }))
  }
  //
  this.server
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler())

  // process packet to client
  this.user
    .use(junction.presenceParser())
  if (process.env.DEBUG) {
    this.user.use(junction.dump({ prefix: 'USER: ' }))
  }
  this.user
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler())
}

module.exports = Router

Router.prototype.route = function (jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('route %s %s', jid, stanza)
  this.redis.publish('route:' + jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to subscribe')
  }
  var channel = 'route:' + jid
  var listener = (stanza) => {
    debug('got stanza', stanza)
    client.send(stanza)
  }
  listener.client = client
  this._channelEmitter.addListener(channel, listener)
  this.redsub.subscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('registered route %s -> %s', jid, client.id)
  })
}

Router.prototype.unregisterRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to unsubscribe')
  }
  var channel = 'route:' + jid
  var listener = this._channelEmitter.listeners(channel).find(listener => listener.client === client)
  if (!listener) {
    // FIXME throw new Error(`No listener for ${client.id} on ${channel}`)
    return
  }
  this._channelEmitter.removeListener(channel, listener)
  this.redsub.unsubscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('unregistered route %s -> %s', jid, client.id)
  })
}

Router.prototype.onMessage = function (channel, message) {
  debug('message', channel, message)
  this._channelEmitter.emit(channel, message)
}

Router.prototype.queue = function (jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('queue %s %s', jid, stanza)
  this.redis.lpush('queue:' + jid, stanza.toString())
}

Router.prototype.process = function (stanza, client) {
  stanza.connection = client.connection
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  let to = stanza.attrs.to || xmpp.JID(stanza.attrs.from).bare().toString()
  let jid = new xmpp.JID(to)
  if (jid.local) {
    // to user
    if (jid.resource) {
      // direct
      this.route(jid, stanza)
    } else {
      this.user.handle(stanza)
    }
  } else {
    // to server
    this.server.handle(stanza)
  }
}
