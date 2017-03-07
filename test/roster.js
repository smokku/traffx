'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import Router from '../modules/router'
import path from 'path'
import bunyan from 'bunyan'

const testName = path.basename(__filename, '.js')
const log = bunyan.createLogger({ name: testName, level: bunyan.FATAL + 1 })
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
      dumpExceptions: false,
      log
      const response = router.makeResponse(stanza.to, stanza)
    })
    router.iq = function (stanza) {
      stanza = stanza.root()
      return new Promise((resolve, reject) => {
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

test('roster set invalid', async t => {
  const get1 = iq('get')
  get1.root().attrs.from = 'some@otherhost/hacker'
  const res1 = await router.iq(get1)
  t.is(res1.attrs.type, 'error')
  t.is(res1.attrs.id, 'get_1')
  const err1 = res1.getChild('error')
  t.is(err1.attrs.type, 'auth')
  const set2 = iq('set', 2).c('item', { jid: 'one@example.com' })
  set2.root().attrs.from = 'some@otherhost'
  const res2 = await router.iq(set2)
  t.is(res2.attrs.type, 'error')
  t.is(res2.attrs.id, 'set_2')
  const err2 = res2.getChild('error')
  t.is(err2.attrs.type, 'auth')

  const set3 = iq('set', 3)
  const res3 = await router.iq(set3)
  t.is(res3.attrs.type, 'error', 'no item')
  t.is(res3.attrs.id, 'set_3')
  const err3 = res3.getChild('error')
  t.is(err3.attrs.type, 'modify')

  const set4 = iq('set', 4)
  set4.c('item', { jid: 'one@example.com' })
  set4.c('item', { jid: 'two@example.com' })
  const res4 = await router.iq(set4)
  t.is(res4.attrs.type, 'error', 'too many items')
  t.is(res4.attrs.id, 'set_4')
  const err4 = res4.getChild('error')
  t.is(err4.attrs.type, 'modify')

  const set5 = iq('set', 5).c('item', {})
  const res5 = await router.iq(set5)
  t.is(res5.attrs.type, 'error', 'no jid')
  t.is(res5.attrs.id, 'set_5')
  const err5 = res5.getChild('error')
  t.is(err5.attrs.type, 'modify')
  // TODO repeating group, empty group
})

test('roster set/get/update/delete', async t => {
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
  t.deepEqual(new Set(items4.map(item => item.attrs.name)), new Set([
    'One',
    undefined
  ]))

  const set5 = iq('set', 5).c('item', { jid: 'two@example.com', name: 'Two' })
  const res5 = await router.iq(set5)
  t.is(res5.attrs.type, 'result')
  t.is(res5.attrs.id, 'set_5')
  const set6 = iq('set', 6).c('item', { jid: 'one@example.com' })
  const res6 = await router.iq(set6)
  t.is(res6.attrs.type, 'result')
  t.is(res6.attrs.id, 'set_6')
  const get7 = iq('get', 7)
  const res7 = await router.iq(get7)
  t.is(res7.attrs.type, 'result')
  t.is(res7.attrs.id, 'get_7')
  const query7 = res7.getChild('query', 'jabber:iq:roster')
  t.truthy(query7)
  t.truthy(query7.attrs.ver)
  const items7 = query7.getChildren('item')
  t.is(items7.length, 2)
  t.deepEqual(new Set(items7.map(item => item.attrs.name)), new Set([
    'Two',
    undefined
  ]))
  const set8 = iq('set', 8).c('item', { jid: 'two@example.com', name: '' })
  const res8 = await router.iq(set8)
  t.is(res8.attrs.type, 'result')
  t.is(res8.attrs.id, 'set_8')
  const get9 = iq('get', 9)
  const res9 = await router.iq(get9)
  t.is(res9.attrs.type, 'result')
  t.is(res9.attrs.id, 'get_9')
  const query9 = res9.getChild('query', 'jabber:iq:roster')
  t.truthy(query9)
  t.truthy(query9.attrs.ver)
  const items9 = query9.getChildren('item')
  t.is(items9.length, 2)
  t.deepEqual(new Set(items9.map(item => item.attrs.name)), new Set([
    undefined,
    undefined
  ]))

  const setA = iq('set', 'A').c('item', {
    jid: 'one@example.com',
    subscription: 'remove'
  })
  const resA = await router.iq(setA)
  t.is(resA.attrs.type, 'result')
  t.is(resA.attrs.id, 'set_A')
  const getB = iq('get', 'B')
  const resB = await router.iq(getB)
  t.is(resB.attrs.type, 'result')
  t.is(resB.attrs.id, 'get_B')
  const queryB = resB.getChild('query', 'jabber:iq:roster')
  t.truthy(queryB)
  t.truthy(queryB.attrs.ver)
  const itemsB = queryB.getChildren('item')
  t.is(itemsB.length, 1)
  t.is(itemsB[0].attrs.jid, 'two@example.com')
})
