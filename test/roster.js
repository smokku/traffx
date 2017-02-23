'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import Router from '../modules/router'
import path from 'path'

const testName = path.basename(__filename, '.js')
const dynalite = require('dynalite')()
const dynaPort = 10000 + process.pid
var router

test.cb.before(t => {
  dynalite.listen(dynaPort, err => {
    t.ifError(err)
    router = new Router({
      db: 1,
      prefix: testName,
      dynamo: 'http://localhost:' + dynaPort,
      dumpExceptions: false
    })
    router.iq = function (stanza) {
      stanza = stanza.root()
      return new Promise((resolve, reject) => {
        const response = router.iqResponse(stanza.to, stanza)
        response.send = function () {
          resolve(this)
        }
        this.user.handle(stanza, response, reject)
      })
    }
    t.end()
  })
})

function iq (type, seq = 1) {
  return new xmpp.Stanza('iq', {
    to: 'roster@localhost',
    from: 'roster@localhost/res',
    type,
    id: `${type}_${seq}`
  }).c('query', { xmlns: 'jabber:iq:roster' })
}

test('roster get empty', async t => {
  t.plan(8)

  const get = iq('get')
  const res1 = await router.iq(get)
  t.is(res1.attrs.type, 'result')
  t.is(res1.attrs.id, 'get_1')
  const query1 = res1.getChild('query', 'jabber:iq:roster')
  t.truthy(query1)
  const items1 = query1.getChildren('item')
  t.is(items1.length, 0)
  get.c('item')
  const res2 = await router.iq(get)
  t.is(res2.attrs.type, 'error')
  const err2 = res2.getChild('error')
  t.truthy(err2)
  t.is(err2.attrs.type, 'modify')
  t.truthy(err2.getChild('bad-request', 'urn:ietf:params:xml:ns:xmpp-stanzas'))
})

test('roster set/get', async t => {
  t.plan(15)

  const set1 = iq('set').c('item', { jid: 'one@example.com', name: 'One' })
  const res1 = await router.iq(set1)
  t.is(res1.attrs.type, 'result')
  t.is(res1.attrs.id, 'set_1')
  const get2 = iq('get', 2)
  const res2 = await router.iq(get2)
  t.is(res2.attrs.type, 'result')
  t.is(res2.attrs.id, 'get_2')
  const query2 = res2.getChild('query', 'jabber:iq:roster')
  t.truthy(query2)
  t.truthy(query2.attrs.ver)
  const items2 = query2.getChildren('item')
  t.is(items2.length, 1)
  const set3 = iq('set', 3).c('item', { jid: 'two@example.com' })
  const res3 = await router.iq(set3)
  t.is(res3.attrs.type, 'result')
  t.is(res3.attrs.id, 'set_3')
  const get4 = iq('get', 4)
  const res4 = await router.iq(get4)
  t.is(res4.attrs.type, 'result')
  t.is(res4.attrs.id, 'get_4')
  const query4 = res4.getChild('query', 'jabber:iq:roster')
  t.truthy(query4)
  t.truthy(query4.attrs.ver)
  const items4 = query4.getChildren('item')
  t.is(items4.length, 2)
  t.deepEqual(new Set(items4.map(item => item.attrs.name)), new Set([ 'One', undefined ]))
})
