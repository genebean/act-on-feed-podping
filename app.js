var dhive = require("@hiveio/dhive");
// var es = require("event-stream"); // npm install event-stream
var util = require("util");

const axios = require('axios')
const postURL = 'https://www.toptal.com/developers/postbin/1674963562907-6917490453924'
const myRSSFeed = 'https://feeds.buzzsprout.com/2053906.rss'
const sendPost = false
const showAllFeeds = false

const addressList = [
  "https://api.openhive.network",
  "https://api.hive.blog",
  "https://anyx.io",
  "https://api.deathwing.me",
]

const client = new dhive.Client(
  addressList, {
  // reducing timeout and threshold makes fall over to other API address happen faster
  timeout: 6000, // in ms
  failoverThreshold: 1,
}
);

let validAccounts = ['podping']
let lastBlockNumber = undefined


MEDIUM_PODCAST = "podcast"
MEDIUM_AUDIOBOOK = "audiobook"
MEDIUM_BLOG = "blog"
MEDIUM_FILM = "film"
MEDIUM_MUSIC = "music"
MEDIUM_NEWSLETTER = "newsletter"
MEDIUM_VIDEO = "video"

PodpingMedium = [
  MEDIUM_PODCAST,
  MEDIUM_AUDIOBOOK,
  MEDIUM_BLOG,
  MEDIUM_FILM,
  MEDIUM_MUSIC,
  MEDIUM_NEWSLETTER,
  MEDIUM_VIDEO,
]

REASON_LIVE = "live"
REASON_LIVE_END = "liveEnd"
REASON_UPDATE = "update"

PodpingReason = [
  REASON_LIVE,
  REASON_LIVE_END,
  REASON_UPDATE,
]

/**
 * Checks if account making PodPing is allowed
 *
 * @param required_posting_auths account used to make PodPing post
 * @returns true if account is valid
 */
function isAccountAllowed(required_posting_auths) {
  // check if valid user
  let postingAuths = new Set(required_posting_auths)
  let accounts = new Set(validAccounts)
  let intersect = new Set()
  for (let x of accounts) {
    if (postingAuths.has(x))
      intersect.add(x)
  }
  // if accounts don't overlap, skip post
  return intersect.size !== 0
}

/**
* Handle PodPing post
*
* @param post received post in operation
* @param timestamp timestamp for block post is in
* @param blockNumber block number post is in
* @param transactionId transaction identifier post is in
*/
function handlePodpingPost(post, timestamp, blockNumber, transactionId) {
  if (!isAccountAllowed(post.required_posting_auths))
    return

  let postJson = JSON.parse(post.json)

  let version = postJson.version || postJson.v
  let updateReason = postJson.reason || postJson.r || postJson.type
  let medium = postJson.medium

  let versionValue = parseFloat(version)
  if (isNaN(versionValue)) {
    // fallback to any possible
    // old posts didn't include an update type so still accept them
    if (updateReason !== undefined && updateReason !== "feed_update" && updateReason !== 1)
      return
  } else {
    // handle version 1.0 and newer
    if (!(PodpingReason.includes(updateReason) && PodpingMedium.includes(medium))) {
      return
    }
  }

  let iris = postJson.iris || []
  let urls = postJson.urls || []
  if (urls) {
    iris = iris.concat(urls)
  }
  if (postJson.url) {
    iris = [postJson.url]
  }

  // add ping
  for (let iri of iris) {
    outputMessage = {
      timestamp: timestamp,
      blockNumber: blockNumber,
      transactionId: transactionId,
      updateReason: updateReason,
      medium: medium,
      rss: iri,
    }
    // console.log(JSON.stringify(outputMessage))

    if (outputMessage['rss'] === myRSSFeed) {
      console.log('my feed was updated at ', outputMessage['timestamp'], ' with reason code ', outputMessage['updateReason'])

      if (sendPost) {
        axios
          .post(postURL, outputMessage)
          // .then(res => {
          //   console.log(`Status: ${res.status}`)
          //   console.log('Body: ', res.data)
          // })
          .catch(err => {
            console.error(err)
          })
      }
    } else {
      if (showAllFeeds) {
        console.log('not my feed: ', outputMessage['rss'])
      }
    }
  }
}

/**
 * Handle custom JSON post and check if desired type
 *
 * @param post received post in operation
 * @param timestamp timestamp for block post is in
 * @param blockNumber block number post is in
 * @param transactionId transaction identifier post is in
 */
function handleCustomJsonPost(post, timestamp, blockNumber, transactionId) {
  if (post.id === "podping" || post.id.startsWith("pp_")) {
    handlePodpingPost(post, timestamp, blockNumber, transactionId)
  }
}

/**
 * Handle operation included in transaction
 *
 * @param operation received operation
 * @param timestamp timestamp for block operation is in
 * @param blockNumber block number operation is in
 * @param transactionId transaction operation is in
 */
function handleOperation(operation, timestamp, blockNumber, transactionId) {
  let operationType = operation[0]
  if (operationType === "custom_json") {
    let post = operation[1]
    handleCustomJsonPost(post, timestamp, blockNumber, transactionId)
  }
}

/**
 * Handle transaction included in block
 *
 * @param transaction received transaction
 * @param timestamp timestamp for block transaction is in
 */
function handleTransaction(transaction, timestamp) {
  let blockNumber = transaction.block_num
  let transactionId = transaction.transaction_id
  lastBlockNumber = blockNumber

  for (let operation of transaction.operations) {
    handleOperation(operation, timestamp, blockNumber, transactionId)
  }
}

/**
 * Handle new block received
 *
 * @param block received block
 */
function handleBlock(block) {
  try {
    let timestamp = block.timestamp

    for (let transaction of block.transactions) {
      handleTransaction(transaction, timestamp)
    }
  } catch (error) {
    console.error("error handling block")
    console.error(error)
  }
}

function startStream(blockNumber = undefined) {
  // can pass the block number to start searching from. By default, uses the current block
  // note: using mode BlockchainMode.Latest does not seem to return data using `getOperationsStream` so
  // `getBlockStream` is used instead and transactions are parsed by block
  client.blockchain.getBlockStream({
    from: blockNumber,
    mode: dhive.BlockchainMode.Latest
  })
    .on('data', handleBlock)
    .on('error',
      function (error) {
        console.error('Error occurred parsing stream')
        console.error(error)
        // Note: when an error occurs, the `end` event is emitted (see below)
      }
    )
    .on('end',
      function () {
        console.log('Reached end of stream')
        // Note: this restart the stream
        startStream(lastBlockNumber);
      }
    );
}

client.database.call('get_following', [validAccounts[0], null, 'blog', 100])
  .then(
    /**
     * Get all accounts that are accepted as a valid PodPing poster
     *
     * @param followers list of follower objects
     */
    function (followers) {
      for (let follower of followers) {
        validAccounts = validAccounts.concat(follower.following)
      }
    }
  )
  .then(
    startStream
  )
  ;

