'use strict'
import test from 'ava'
import { C2S } from 'node-xmpp-server'
import xmpp from 'node-xmpp-client'
import { stanza as pkt } from 'node-xmpp-core'
import path from 'path'
import { uniq } from '../utils'

const testName = path.basename(__filename, '.js')

const port = 10000 + process.pid
// eslint-disable-next-line no-unused-vars
var router, c2s, Roster
test.before(async t => {
  router = await require('./_router')(testName)
  c2s = await require('./_c2s')(new C2S.TCPServer({ port }), router)
  Roster = require('../models/roster')
})

function checkEnd (t, endings) {
  return function cond () {
    if (--endings === 0) t.end()
  }
}

test.cb.beforeEach(t => {
  t.context.sendr = new xmpp.Client({
    port,
    jid: uniq() + '@localhost',
    password: 'password'
  })
  t.context.sendr.on('online', sess => {
    t.context.sendr.session = sess
    t.context.recvr = new xmpp.Client({
      port,
      jid: uniq() + '@localhost',
      password: 'password'
    })
    t.context.recvr.on('online', sess => {
      t.context.recvr.session = sess
      t.end()
    })
  })
})

test.cb.afterEach(t => {
  t.context.recvr.on('end', () => {
    t.context.sendr.on('end', t.end)
    t.context.sendr.end()
  })
  t.context.recvr.end()
})

test.cb('invalid outbound "to"', t => {
  const client = t.context.sendr
  client.on('error', t.end)
  client.send(pkt`<presence type="subscribe" to=""/>`)
  client.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'error')
    const err = stanza.getChild('error')
    t.truthy(err)
    t.is(err.attrs.type, 'modify')
    t.truthy(
      err.getChild('jid-malformed', 'urn:ietf:params:xml:ns:xmpp-stanzas')
    )
    t.end()
  })
})

test.cb('subscription stamping - empty from', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  const id = uniq()
  sendr.send(
    pkt`<presence type="subscribe" id="${id}" to="${recvr.session.jid.toString()}"/>`
  )
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'subscribe')
    t.is(stanza.id, id)
    t.is(stanza.from, sendr.session.jid.bare().toString())
    t.is(stanza.to, recvr.session.jid.bare().toString())
    t.end()
  })
})

test.cb('subscription stamping - full from', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  const id = uniq()
  sendr.send(
    pkt`<presence type="subscribe" id="${id}" from="${sendr.session.jid.toString()}" to="${recvr.session.jid.toString()}"/>`
  )
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'subscribe')
    t.is(stanza.id, id)
    t.is(stanza.from, sendr.session.jid.bare().toString())
    t.is(stanza.to, recvr.session.jid.bare().toString())
    t.end()
  })
})

test.cb('Requesting a Subscription - denied', t => {
  const end = checkEnd(t, 4)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  const id1 = uniq(3)
  const id2 = uniq(3)
  sendr.send(pkt`<presence type="subscribe" id="${id1}" to="${to}"/>`)
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      t.is(item.attrs.subscription, undefined)
      if (item.attrs.ask === 'subscribe') {
        end()
      }
      if (item.attrs.ask === undefined) {
        end()
      }
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'unsubscribed')
      t.is(stanza.id, id2)
      t.is(stanza.from, to)
      t.is(stanza.to, from)
      end()
    } else {
      t.end(stanza.name)
    }
  })
  recvr.on('stanza', stanza => {
    if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribe')
      t.is(stanza.id, id1)
      t.is(stanza.from, from)
      t.is(stanza.to, to)
      recvr.send(
        pkt`<presence type="unsubscribed" id="${id2}" to="${stanza.from}"/>`
      )
      end()
    } else {
      t.end(stanza.name)
    }
  })
})

function requestApprove (t, start) {
  const end = checkEnd(t, 5)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const opts = {
    from: sendr.session.jid.bare().toString(),
    to: recvr.session.jid.bare().toString(),
    id1: uniq(3),
    id2: uniq(3),
    name: uniq(5)
  }
  start(t, opts, err => {
    t.ifError(err)
    sendr.send(
      pkt`<presence type="subscribe" id="${opts.id1}" to="${opts.to}"/>`
    )
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, opts.to)
      if (item.attrs.ask) {
        t.is(item.attrs.ask, 'subscribe')
        end()
      } else {
        t.is(item.attrs.subscription, 'to')
        end()
      }
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribed')
      t.is(stanza.id, opts.id2)
      t.is(stanza.from, opts.to)
      t.is(stanza.to, opts.from)
      end()
    } else {
      t.end(stanza.name)
    }
  })
  recvr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, opts.from)
      t.is(item.attrs.name, opts.name)
      t.is(item.attrs.subscription, 'from')
      end()
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribe')
      t.is(stanza.id, opts.id1)
      t.is(stanza.from, opts.from)
      t.is(stanza.to, opts.to)
      recvr.send(
        pkt`<presence type="subscribed" id="${opts.id2}" to="${stanza.from}"/>`
      )
      end()
    } else {
      t.end(stanza.name)
    }
  })
}

// eslint-disable-next-line ava/test-ended
test.cb('Requesting a Subscription - unknown contact', t => {
  requestApprove(t, (t, opts, cb) => {
    opts.name = undefined
    cb()
  })
})

// eslint-disable-next-line ava/test-ended
test.cb('Requesting a Subscription - already existing contact', t => {
  requestApprove(t, (t, opts, cb) => {
    Roster.set(opts.to, opts.from, { from: false, to: false, name: opts.name }).then(() => cb()).catch(cb)
  })
})

test.cb('Requesting a Subscription - already approved contact', t => {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  // subscription should be approved already
  recvr.on('stanza', stanza => t.end(stanza.toString()))

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  Roster.set(to, from, { from: true }).then(() => {
    sendr.send(pkt`<presence type="subscribe" from="${from}" to="${to}"/>`)
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      // ask="subscribe" push
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      if (item.attrs.ask) {
        t.is(item.attrs.ask, 'subscribe')
        end()
      } else {
        t.is(item.attrs.subscription, 'to')
        end()
      }
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribed')
      t.is(stanza.from, to)
      t.is(stanza.to, from)
      end()
    } else {
      t.end(stanza.name)
    }
  })
})

test.cb('Requesting a Subscription - pre-approved contact', t => {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  Roster.set(to, from, { approved: true }).then(() => {
    sendr.send(pkt`<presence type="subscribe" from="${from}" to="${to}"/>`)
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      if (item.attrs.ask) {
        t.is(item.attrs.ask, 'subscribe')
      } else {
        t.is(item.attrs.subscription, 'to')
        end()
      }
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribed')
      t.is(stanza.from, to)
      t.is(stanza.to, from)
      end()
    } else {
      t.end(stanza.name)
    }
  })
  recvr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, from)
      t.is(item.attrs.subscription, 'from')
      t.is(item.attrs.approved, 'true')
      end()
    } else {
      t.end(stanza.name)
    }
  })
})

test.cb('Pre-Approving a Subscription Request', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  // pre-approved user should not be bothered
  recvr.on('stanza', t.end)

  const sub = sendr.streamFeatures.getChild(
    'sub',
    'urn:xmpp:features:pre-approval'
  )
  t.truthy(sub)

  const to = recvr.session.jid.bare().toString()
  sendr.send(
    pkt`<presence type="subscribed" from="${sendr.session.jid.toString()}" to="${to}"/>`
  )
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      t.is(item.attrs.subscription, undefined)
      t.is(item.attrs.approved, 'true')
      t.end()
    } else {
      t.end(stanza.name)
    }
  })
})

test.cb('Canceling Pre-Approval', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  // pre-approved user should not be bothered
  recvr.on('stanza', t.end)

  const sub = sendr.streamFeatures.getChild(
    'sub',
    'urn:xmpp:features:pre-approval'
  )
  t.truthy(sub)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  Roster.set(from, to, { approved: true }).then(() => {
    sendr.send(pkt`<presence type="unsubscribed" from="${from}" to="${to}"/>`)
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      t.is(item.attrs.ask, undefined)
      t.is(item.attrs.subscription, undefined)
      t.end()
    } else {
      t.end(stanza.name)
    }
  })
})

function removing (t, request, fromState, fromWanted, toState, toWanted) {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  const id = uniq()
  Roster.set(from, to, fromState).then(() => {
    Roster.set(to, from, toState).then(() => {
      sendr.send(
        pkt`<presence type="${request}" id="${id}" from="${from}" to="${to}"/>`
      )
    })
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      t.is(item.attrs.subscription, fromWanted)
      end()
    } else {
      t.end(stanza.name)
    }
  })
  recvr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, from)
      t.is(item.attrs.subscription, toWanted)
      end()
    } else if (stanza.is('presence')) {
      t.is(stanza.type, request)
      t.is(stanza.id, id)
      t.is(stanza.from, from)
      t.is(stanza.to, to)
      end()
    } else {
      t.end(stanza.name)
    }
  })
}

// eslint-disable-next-line ava/test-ended
test.cb(
  'Unsubscribing - one-way',
  removing,
  'unsubscribe',
  { to: true },
  undefined,
  { from: true },
  undefined
)
// eslint-disable-next-line ava/test-ended
test.cb(
  'Unsubscribing - mutual',
  removing,
  'unsubscribe',
  { from: true, to: true },
  'from',
  { from: true, to: true },
  'to'
)

test.cb('Canceling a Subscription - unknown', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  // should not be bothered when unknown
  recvr.on('stanza', t.end)

  sendr.send(
    pkt`<presence type="unsubscribed" to="${recvr.session.jid.toString()}"/>`
  )
  // should be no response
  sendr.on('stanza', t.end)
  // but give chance to respond
  setTimeout(() => t.end(), 500)
})

// eslint-disable-next-line ava/test-ended
test.cb(
  'Canceling a Subscription - one-way',
  removing,
  'unsubscribed',
  { from: true },
  undefined,
  { to: true },
  undefined
)
// eslint-disable-next-line ava/test-ended
test.cb(
  'Canceling a Subscription - mutual',
  removing,
  'unsubscribed',
  { from: true, to: true },
  'to',
  { from: true, to: true },
  'from'
)

test.cb('Canceling a Subscription - pending', t => {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  sendr.send(pkt`<presence type="subscribe" to="${to}"/>`)
  let ask = 'subscribe'
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      t.is(item.attrs.ask, ask)
      // will enter 2x for two roster pushes
      end()
    } else {
      t.end(stanza.name)
    }
  })
  recvr.on('stanza', stanza => {
    if (stanza.is('presence')) {
      if (stanza.type === 'subscribe') {
        t.is(stanza.from, from)
        t.is(stanza.to, to)
        Roster.one(to, from).then(item => {
          t.is(item.jid, from)
          t.truthy(item.in)
          sendr.send(pkt`<presence type="unsubscribe" to="${to}"/>`)
          ask = undefined
          setTimeout(
            () => {
              Roster.one(to, from).then(item => {
                t.falsy(item)
                end()
              }).catch(t.end)
            },
            500
          )
        })
      } else {
        t.end(stanza.name)
      }
    } else {
      t.end(stanza.name)
    }
  })
})

test.cb('Requesting a Subscription - client resend', t => {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  sendr.send(pkt`<presence type="subscribe" to="${to}"/>`)
  recvr.on('stanza', stanza => {
    if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribe')
      t.is(stanza.from, from)
      t.is(stanza.to, to)
      // now publish sendr presence to trigger resend
      sendr.send(pkt`<presence/>`)
      end() // will happen 3 times because of resending
    } else {
      t.end(stanza.name)
    }
  })
})

test.cb('Requesting a Subscription - target resend', t => {
  const end = checkEnd(t, 3)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  sendr.send(pkt`<presence type="subscribe" to="${to}"/>`)
  recvr.on('stanza', stanza => {
    if (stanza.is('presence')) {
      // ignore broadcast to self
      if (!stanza.type) return
      t.is(stanza.type, 'subscribe')
      t.is(stanza.from, from)
      t.is(stanza.to, to)
      // now publish recvr presence to trigger resend
      recvr.send(pkt`<presence/>`)
      end() // will happen 3 times because of resending
    } else {
      t.end(stanza.name)
    }
  })
})
