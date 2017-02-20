'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import Router from '../modules/router'
import path from 'path'

const testName = path.basename(__filename, '.js')
const router = new Router({ db: 1, prefix: testName })

router.iq = function (stanza) {
  stanza = stanza.root()
  return new Promise((resolve, reject) => {
    const response = router.iqResponse('localhost', stanza)
    response.send = function () {
      resolve(this)
    }
    this.user.handle(stanza, response, reject)
  })
}

test('roster get empty', async t => {
  t.plan(7)

  const get = new xmpp.Stanza('iq', {
    from: 'roster1@localhost',
    type: 'get',
    id: 'get_1'
  }).c('query', { xmlns: 'jabber:iq:roster' })
  const res1 = await router.iq(get)
  t.is(res1.attrs.type, 'result')
  t.is(res1.attrs.id, 'get_1')
  const items1 = res1.getChildren('item')
  t.is(items1.length, 0)
  get.c('item')
  const res2 = await router.iq(get)
  t.is(res2.attrs.type, 'error')
  const err2 = res2.getChild('error')
  t.truthy(err2)
  t.is(err2.attrs.type, 'modify')
  t.truthy(err2.getChild('bad-request', 'urn:ietf:params:xml:ns:xmpp-stanzas'))
})
