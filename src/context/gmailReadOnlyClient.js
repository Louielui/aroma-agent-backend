'use strict'
const auth = require('./googleAuth')
function createGmailReader (mailbox, { ownerOAuth = auth.createOAuthClient, adminOAuth = auth.loadAdminMailReadOnlyGrant, serviceFactory = auth.serviceWithOAuth } = {}) {
  if (!['owner', 'admin'].includes(mailbox)) throw Error('invalid_mailbox')
  const oauth = mailbox === 'owner' ? ownerOAuth() : adminOAuth().client
  Object.assign(oauth.transporter.defaults, { timeout: 8000, retry: false })
  const client = serviceFactory('gmail', 'v1', oauth), signal = AbortSignal.timeout(30000)
  const options = () => ({ timeout: 8000, retry: false, maxRedirects: 0, maxContentLength: 1024 * 1024, signal })
  return Object.freeze({
    async identity () {
      const token = await oauth.getAccessToken()
      if (!token?.token) throw Error('identity_unavailable')
      const info = await oauth.getTokenInfo(token.token)
      return { scopes: Array.isArray(info.scopes) ? info.scopes : null }
    },
    async metadata () { return (await client.users.getProfile({ userId: 'me', fields: 'emailAddress,messagesTotal,threadsTotal' }, options())).data },
    async listMessages ({ q }) { return (await client.users.messages.list({ userId: 'me', maxResults: 10, labelIds: ['INBOX'], includeSpamTrash: false,
      fields: 'messages(id),nextPageToken,resultSizeEstimate', ...(q ? { q } : {}) }, options())).data },
    async getMessage (id, full = false) {
      return (await client.users.messages.get({ userId: 'me', id, format: full ? 'full' : 'metadata',
        ...(full ? {} : { metadataHeaders: ['Subject', 'From', 'To', 'Date'] }),
        fields: full ? 'id,threadId,internalDate,labelIds,snippet,payload' : 'id,threadId,internalDate,labelIds,snippet,payload/headers' }, options())).data
    }
  })
}
module.exports = { createGmailReader }
