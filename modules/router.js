const debug = require('debug')('medium:router')
const redis = require('redis-node')

function Router (opts = {}) {
  this.opts = opts
  this.redis = opts.redis || redis.createClient()
  this.redsub = opts.redsub || redis.createClient()
}

Router.prototype.route = function (jid, stanza) {
  this.redis.publish(jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  debug('registered route %s -> %s', jid, client.id)
  this.redsub.subscribeTo(jid, (channel, stanza, pattern) => {
    client.send(stanza)
  })
  return true
}

Router.prototype.unregisterRoute = function (jid, client) {
  debug('unregistered route %s -> %s', jid, client.id)
  this.redsub.unsubscribeFrom(jid)
  return true
}

module.exports = Router
