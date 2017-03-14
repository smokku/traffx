const debug = require('debug')('traffic:router')
const redis = require('redis')
const Redlock = require('redlock')
const dynamoose = require('dynamoose')
const xmpp = require('node-xmpp-core')
const EventEmitter = require('events')
const junction = require('junction')
const pjson = require('./package.json')
const os = require('os')

const markerLocal = '!'
const markerRemote = '^'

function Router (opts = {}) {
  this.opts = opts

  this.router = opts.router

  this.log = opts.log.child({ module: 'router' })

  this.region = opts.region
  if (process.env.NODE_ENV === 'development') {
    if (!this.region) this.region = 'local'
    dynamoose.local(opts.dynamo || 'http://localhost:' + 4567)
  }
  dynamoose.AWS.config.update({ region: this.region })

  this.dumpExceptions = opts.dumpExceptions != null
    ? opts.dumpExceptions
    : true

  this.db = opts.db || 0
  this.prefix = opts.prefix ? opts.prefix + '/' : undefined
  this.redis = opts.redis ||
    redis.createClient({ db: this.db, prefix: this.prefix })
  this.redsub = opts.redsub || this.redis.duplicate()
  this.redlock = new Redlock([ this.redis ], { retryCount: 0 })

  this.redis.on('error', err => this.log.error(err))
  this.redlock.on('clientError', err => this.log.error(err))

  // route messaging
  this._channelEmitter = new EventEmitter().setMaxListeners(0)
  this.redsub.on('message', this.onMessage.bind(this))

  // queue messaging
  this.queueLock = 3000
  this.queueChannel = `__keyevent@${this.redsub.options.db}__:lpush`
  this.redsub.config('SET', 'notify-keyspace-events', 'El')
  this.redsub.subscribe(this.queueChannel)

  // packet from c2s to the world
  var outbound = this.outbound = junction()
  if (process.env.DEBUG) {
    outbound.use(
      require('./modules/logger')({ prefix: 'C2S: ', logger: debug })
    )
  }
  var route = (stanza, next) => {
    this.process(stanza)
  }
  outbound
    .use(require('./modules/subscription').outbound(this))
    .use(route)
    .use(junction.errorHandler({ dumpExceptions: this.dumpExceptions }))

  // process packet to server
  var server = this.server = junction()
  if (process.env.DEBUG) {
    server.use(
      require('./modules/logger')({ prefix: 'SERVER: ', logger: debug })
    )
  }
  server
    .use(require('junction-lastactivity')())
    .use(require('junction-ping')())
    .use(
      require('junction-softwareversion')(pjson.name, pjson.version, Router.os)
    )
    .use(require('junction-time')())
    .use(
      junction.middleware.serviceDiscovery(
        [ { category: 'server', type: 'im' } ],
        [
          'http://jabber.org/protocol/disco#info',
          // 'http://jabber.org/protocol/disco#items', // FIXME
          'jabber:iq:last',
          'urn:xmpp:ping',
          'jabber:iq:version',
          'urn:xmpp:time'
        ]
      )
    )
  server
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler({ dumpExceptions: this.dumpExceptions }))

  // process packet to client
  var user = this.user = junction()
  if (process.env.DEBUG) {
    user.use(require('./modules/logger')({ prefix: 'USER: ', logger: debug }))
  }
  user
    .use(require('./modules/roster')(this))
    .use(require('junction-lastactivity')())
    .use(require('./modules/subscription')(this))
    .use(junction.presenceParser())
    .use(require('./modules/deliver')(this))
  user
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler({ dumpExceptions: this.dumpExceptions }))
}

Router.os = `${process.release.name}/${process.release.lts ||
  process.versions.node.split('.')[0]} (${os.type()} ${os.arch()})`

module.exports = Router

/* Push stanza to directly connected client(s)
 */
Router.prototype.route = function (jid, stanza) {
  if (!jid) {
    throw new Error('Route jid required')
  }
  debug('route %s %s', jid, stanza)
  this.redis.publish('route:' + jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to subscribe')
  }
  var channel = 'route:' + jid
  var listener = stanza => {
    debug('got stanza', stanza)
    client.send(stanza)
  }
  listener.client = client
  this._channelEmitter.addListener(channel, listener)
  this.redsub.subscribe(channel, (err, reply) => {
    if (err) throw err
    // TODO Analyze this
    debug('registered route %s -> %s', jid, client.id)
  })
}

Router.prototype.unregisterRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to unsubscribe')
  }
  var channel = 'route:' + jid
  var listener = this._channelEmitter
    .listeners(channel)
    .find(listener => listener.client === client)
  if (!listener) {
    // FIXME throw new Error(`No listener for ${client.id} on ${channel}`)
    return
  }
  this._channelEmitter.removeListener(channel, listener)
  this.redsub.unsubscribe(channel, (err, reply) => {
    if (err) throw err
    // TODO Analyze this
    debug('unregistered route %s -> %s', jid, client.id)
  })
}

/* Enqueue delivery to JID
 */
Router.prototype.queue = function (local, jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('queue %s %s', jid, stanza)
  this.redis.lpush(
    'queue:' + jid,
    (local ? markerLocal : markerRemote) + stanza.toString(),
    function (err, res) {
      if (err) this.log.error({ err }, 'queue %s', jid)
    }
  )
}

Router.prototype.onMessage = function (channel, message) {
  debug('message', channel, message)
  if (channel.startsWith('__')) {
    // keyspace notification
    const prefix = this.prefix || ''
    if (channel === this.queueChannel && message.startsWith(prefix)) {
      const name = message.substr(`${prefix}queue:`.length)
      const jid = new xmpp.JID(name)
      const queue = `queue:${name}`
      const lock = `${prefix}lock:${name}`
      if (!jid) {
        throw new Error(`Cannot handle ${queue}`)
      }
      const processQueue = lock => {
        this.redis.rpop(queue, (err, stanza) => {
          if (err) {
            this.log.error({ err }, 'queue %s', queue)
          }
          if (!err && stanza) {
            const local = stanza[0] === markerLocal
            stanza = stanza.slice(1)
            this.dispatch(local, jid, stanza)
            // extend lock and process next queue stanza
            // if failed to extend, this means that someone else is processing
            // the queue already, so we are ok with this
            lock.extend(this.queueLock).then(processQueue)
          } else {
            lock.unlock().catch(err => {
              // we weren't able to reach redis; your lock will eventually expire
              this.log.error({ err }, 'queue %s unlock error', queue)
            })
          }
        })
      }
      this.redlock.lock(lock, this.queueLock).then(processQueue).catch(err => {
        // ignore resource unavailable error - this is expected
        if (!(err instanceof Redlock.LockError)) {
          this.log.error({ err }, 'queue %s lock error', queue)
        }
      })
    }
  } else {
    // stanza routing
    this._channelEmitter.emit(channel, message)
  }
}

/* Build iq-response for iq-get or iq-set stanza
 */
Router.prototype.makeResponse = function (from, stanza) {
  return new xmpp.Stanza(stanza.name, {
    id: stanza.attrs.id,
    from: from.toString(),
    to: stanza.attrs.from,
    type: stanza.is('iq') ? 'result' : null
  })
}

/* Dispatch stanza coming from queue to other queues/routes
 */
Router.prototype.dispatch = function (local, jid, packet) {
  debug('dispatch %s', jid, packet)
  const stanza = xmpp.parse(packet)
  if (!stanza) {
    throw new Error(`Failed to dispatch: ${packet}`)
  }

  if (local) {
    const router = this

    stanza.to = jid.toString()
    stanza.send = stanza => {
      router.process(stanza)
    }

    const response = this.makeResponse(jid, stanza)
    response.send = () => {
      router.process(response)
    }

    if (jid.local) {
      // to user
      if (jid.resource) {
        throw new Error('No FullJID dispatcher') // yet?
      } else {
        this.user.handle(stanza, response, err => {
          if (err) this.log.error(err)
        })
      }
    } else {
      this.server.handle(stanza, response, err => {
        if (err) this.log.error(err)
      })
    }
  } else {
    if (jid.local || jid.resource) {
      this.queue(local, jid.domain, stanza)
    } else {
      // pass to s2s router
      if (stanza.attrs.xmlns === 'jabber:client') {
        stanza.attrs.xmlns = 'jabber:server'
      }
      this.router.send(stanza)
    }
  }
}

/* handle c2s outbound stanza
 */
Router.prototype.handle = function (client, stanza) {
  debug('handle %s', stanza)

  stanza.send = stanza => {
    this.process(stanza)
  }

  const response = this.makeResponse(client.jid, stanza)
  response.send = () => {
    client.send(response)
  }

  this.outbound.handle(stanza, response, err => {
    if (err) {
      this.log.error({ client_id: client.id, client_jid: client.jid, err })
    }
  })
}

/* Process server inbound stanza (from c2s, s2s or internally generated)
 */
Router.prototype.process = function (stanza, local) {
  debug('process %s', stanza, local)
  if (!stanza || !stanza.attrs) {
    throw new Error('Need stanza to process')
  }
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  // s2s packets was already checked for proper to/from
  const to = stanza.attrs.to
    ? new xmpp.JID(stanza.attrs.to)
    : new xmpp.JID(stanza.attrs.from).bare()
  const from = new xmpp.JID(stanza.attrs.from)
  local = local != null ? local : to.domain === from.domain
  if (local && to.local && to.resource) {
    // direct
    this.route(to, stanza)
  } else {
    // dispatched
    this.queue(local, to, stanza)
  }
}
