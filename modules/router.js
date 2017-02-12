const debug = require('debug')('medium:router')
const redis = require('redis')
const xmpp = require('node-xmpp-core')

function Router (opts = {}) {
  this.opts = opts
  this.redis = opts.redis || redis.createClient()
  this.redsub = opts.redsub || redis.createClient()
  this.channelCallbacks = {}
  this.redsub.on('message', (channel, message) => {
    let pubSubCallback = this.channelCallbacks[channel]
    if (pubSubCallback) pubSubCallback(channel, message)
    else this.onMessage(channel, message)
  })
}

Router.prototype.route = function (jid, stanza) {
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  if (!jid) jid = new xmpp.JID(stanza.attrs.from).bare()
  else jid = new xmpp.JID(jid)
  stanza = stanza.toString()
  debug('route %s %s', jid, stanza)

  // TODO insert junction here!
  if (jid.local) {
    // to user
    if (jid.resource) {
      // direct
      this.redis.publish('route:' + jid, stanza)
    } else {
      // routed
      this.redis.lpush('queue:' + jid, stanza)
      this.redis.publish('route:' + jid, stanza)
    }
  } else {
    // to server
    this.redis.lpush('queue:' + new xmpp.JID(jid).bare(), stanza)
  }
}

Router.prototype.registerRoute = function (jid, client) {
  var callbacks = this.channelCallbacks
  var channel = 'route:' + jid
  if (callbacks[channel]) {
    throw new Error(`Channel ${jid} is already subscribed`)
    // FIXME bare-jid may be subscribed many times
  }
  if (!client || !client.id) {
    throw new Error('Invalid client to subscribe')
  }
  callbacks[channel] = (channel, stanza) => {
    debug('got stanza', channel, stanza)
    client.send(stanza)
  }
  callbacks[channel].client = client
  this.redsub.subscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('registered route %s -> %s', jid, client.id)
  })
  return true
}

Router.prototype.unregisterRoute = function (jid) {
  var callbacks = this.channelCallbacks
  var channel = 'route:' + jid
  if (!callbacks[channel]) return
  var client = callbacks[channel].client
  delete callbacks[channel]
  this.redsub.unsubscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('unregistered route %s -> %s', jid, client.id)
  })
  return true
}

Router.prototype.onMessage = function (channel, message) {
  debug('message', channel, message)
}

module.exports = Router
