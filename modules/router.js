const debug = require('debug')('medium:router')
const redis = require('redis-node')
const xmpp = require('node-xmpp-core')

function Router (opts = {}) {
  this.opts = opts
  this.redis = opts.redis || redis.createClient()
  this.redsub = opts.redsub || redis.createClient()
}

Router.prototype.route = function (jid, stanza) {
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  if (!jid) jid = new xmpp.JID(stanza.attrs.from).bare().toString()
  debug('route', jid, stanza)
  this.redis.publish('route:' + jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  debug('registered route %s -> %s', jid, client.id)
  this.redsub.subscribeTo('route:' + jid, (channel, stanza, pattern) => {
    debug('got stanza', channel, stanza, pattern)
    client.send(stanza)
  })
  return true
}

Router.prototype.unregisterRoute = function (jid, client) {
  debug('unregistered route %s -> %s', jid, client.id)
  this.redsub.unsubscribeFrom('route:' + jid)
  return true
}

module.exports = Router
