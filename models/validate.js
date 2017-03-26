const xmpp = require('node-xmpp-core')

exports.user = v =>
  typeof v === 'string' && v === new xmpp.JID(v).bare().toString()
