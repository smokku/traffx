'use strict'
import test from 'ava'
import { stanza, JID } from 'node-xmpp-core'
import Router from '../modules/router'
import path from 'path'

const testName = path.basename(__filename, '.js')
var router

const uniq = function () {
  return Math.random().toString(36).substring(7)
}

test.cb.before(t => {
  router = new Router({ db: 1, prefix: testName, dumpExceptions: false })
  router.iq = function (stanza) {
    stanza = stanza.root()
    let from = stanza.to || new JID(stanza.from).bare().toString()
    return new Promise((resolve, reject) => {
      const response = router.iqResponse(from, stanza)
      response.send = function () {
        resolve(this)
      }
      this.user.handle(stanza, response, reject)
    })
  }
  t.end()
})

async function serviceUnavailable (t, stanza) {
  t.plan(5)
  const id = uniq()
  stanza.id = id
  const res = await router.iq(stanza)
  t.is(res.attrs.type, 'error')
  t.is(res.attrs.id, id)
  const err = res.getChild('error')
  t.truthy(err)
  t.is(err.attrs.type, 'cancel')
  t.truthy(
    err.getChild('service-unavailable', 'urn:ietf:params:xml:ns:xmpp-stanzas')
  )
}

test(
  'dummy:service - no "to"',
  serviceUnavailable,
  stanza`
<iq type="get" from="user@localhost/res">
  <query xmlns="dummy:service">
    <foo xmlns="bar"/>
  </query>
</iq>`
)

test(
  'dummy:service - with "to"',
  serviceUnavailable,
  stanza`
  <iq type="get" from="user@localhost/res" to="user@localhost">
    <query xmlns="dummy:service">
      <foo xmlns="bar"/>
    </query>
  </iq>`
)

test(
  'jabber:iq:private',
  serviceUnavailable,
  stanza`
  <iq type="get" from="user@localhost/res">
    <query xmlns="jabber:iq:private">
      <foo xmlns="bar"/>
    </query>
  </iq>`
)
