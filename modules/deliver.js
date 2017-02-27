const xmpp = require('node-xmpp-core')

/* Delivers stanzas addressed to BareJID to connected FullJIDs
 */
module.exports = function (router) {
  return function deliver (stanza, next) {
    // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid
    if (!stanza.attrs.to) return next()
    let jid = new xmpp.JID(stanza.attrs.to)
    if (jid.local && !jid.resource) {
      if (stanza.is('message')) {
        let type = stanza.attrs.type || 'normal'
        switch (type) {
          case 'normal':
          case 'chat':
          case 'headline':
            // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid-resource
            // TODO specific rules are a bit different here, but for now this will do
            router.route(jid, stanza)
            return
        }
        // rest - silently ignore
        return
      }
    }
    next()
  }
}
