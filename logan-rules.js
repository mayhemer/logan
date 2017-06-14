/******************************************************************************
 * RequestContext
 ******************************************************************************/

logan.rule("RequestContext::RequestContext this=%p id=%x", function(ptr, id) {
  this.obj(ptr).create("RequestContext").prop("id", id);
});
logan.rule("RequestContext::RequestContext this=%p blockers=%u", function(ptr) {
  this.obj(ptr).destroy();
});
logan.rule("RequestContext::AddBlockingTransaction this=%p blockers=%u", function(ptr) {
  this.obj(ptr).capture();
});
logan.rule("RequestContext::RemoveBlockingTransaction this=%p blockers=%u", function(ptr) {
  this.obj(ptr).capture();
});

/******************************************************************************
 * HttpChannelParent
 ******************************************************************************/

logan.rule("Creating HttpChannelParent [this=%p]", function(ptr) {
  this.thread.httpchannelparent = this.obj(ptr).create("HttpChannelParent");
});
logan.rule("Destroying HttpChannelParent [this=%p]", function(ptr) {
  this.obj(ptr).destroy();
});

/******************************************************************************
 * nsHttpChannel
 ******************************************************************************/

logan.rule("Creating nsHttpChannel [this=%p]", function(ptr) {
  this.thread.httpchannel = this.obj(ptr).create("nsHttpChannel");
  if (this.thread.httpchannelparent) {
    this.thread.httpchannelparent.link(this.thread.httpchannel);
    this.thread.httpchannelparent = null;
  }
});
logan.ruleIf("uri=%s", proc => proc.thread.httpchannel, function(url) {
  this.thread.httpchannel.prop("url", url);
  this.thread.httpchannel = null;
});
logan.rule("nsHttpChannel::Init [this=%p]", function(ptr) {
  this.thread.httpchannel_init = this.obj(ptr).capture();
});
logan.ruleIf("nsHttpChannel::SetupReplacementChannel [this=%p newChannel=%p preserveMethod=%d]",
  proc => proc.thread.httpchannel_init,
  function(oldch, newch) {
    this.obj(oldch).capture().link(this.thread.httpchannel_init.alias(newch));
    this.thread.httpchannel_init = null;
  });
logan.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr) {
  this.obj(ptr).state("open").capture();
});
logan.rule("nsHttpChannel::OnProxyAvailable [this=%p pi=%p status=%x mStatus=%x]", function(ptr) {
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::Connect [this=%p]", function(ptr) {
  this.obj(ptr).state("connected").capture();
});
logan.rule("nsHttpChannel::OpenCacheEntry [this=%p]", function(ptr) {
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::OnCacheEntryCheck enter [channel=%p entry=%p]", function(ch, entry) {
  this.obj(ch).capture().mention(entry).follow((obj) => obj.capture());
});
logan.rule("nsHTTPChannel::OnCacheEntryCheck exit [this=%p doValidation=%d result=%d]", function(ch, val, result) {
  this.obj(ch).capture();
});
logan.rule("nsHttpChannel::OnCacheEntryAvailable [this=%p entry=%p new=%d appcache=%p status=%x mAppCache=%p mAppCacheForWrite=%p]", function(ch, entry, isnew) {
  this.obj(ch).capture().link(entry);
});
logan.rule("nsHttpChannel::TriggerNetwork [this=%p]", function(ptr) {
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::SetupTransaction [this=%p]", function(ptr) {
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr) {
  this.obj(ch).capture().link(tr);
  this.obj(tr).prop("url", this.obj(ch).props["url"]);
});
logan.rule("nsHttpChannel::Starting nsChannelClassifier %p [this=%p]", function(cl, ch) {
  this.obj(ch).capture().link(cl);
});
logan.rule("nsHttpChannel::ReadFromCache [this=%p] Using cached copy of: %s", function(ptr) {
  this.obj(ptr).capture().prop("from-cache", true);
});
logan.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
  this.obj(ch).capture().state("started");
});
logan.rule("nsHttpChannel::OnDataAvailable [this=%p request=%p offset=%d count=%d]", function(ch, pump) {
  this.obj(ch).capture().state("data");
});
logan.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
  this.obj(ch).capture().prop("status", status).state("finished");
});
logan.rule("nsHttpChannel::SuspendInternal [this=%p]", function(ptr) {
  this.obj(ptr).capture().prop("suspendcount", c => ++c);
});
logan.rule("nsHttpChannel::ResumeInternal [this=%p]", function(ptr) {
  this.obj(ptr).capture().prop("suspendcount", c => --c);
});
logan.rule("nsHttpChannel::Cancel [this=%p status=%x]", function(ptr, status) {
  this.obj(ptr).capture().state("cancelled").prop("status", status);
});
logan.rule("Destroying nsHttpChannel [this=%p]", function(ptr) {
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpChannel", ["state", "url", "status"]);

/******************************************************************************
 * nsHttpTransaction
 ******************************************************************************/

logan.rule("Creating nsHttpTransaction @%p", function(ptr) {
  this.thread.httptransaction = this.obj(ptr).create("nsHttpTransaction");
});
logan.rule("nsHttpTransaction::Init [this=%p caps=%x]", function(trans) {
  this.obj(trans).follow((trans, line) => {
    logan.parse(line, "  window-id = %x", function(id) {
      trans.prop("tab-id", id);
    });
  });
});
logan.ruleIf("http request [", proc => proc.thread.httptransaction, function() {
  this.thread.httptransaction.capture().follow((obj, line) => {
    obj.capture(line);
    return line !== "]";
  });
  this.thread.httptransaction = null;
});
logan.ruleIf("nsHttpConnectionMgr::AtActiveConnectionLimit [ci=%s caps=%d,totalCount=%d, maxPersistConns=%d]",
  proc => proc.thread.httptransaction, function(ci) {
    this.thread.httptransaction.capture().mention(ci);
  });
logan.ruleIf("AtActiveConnectionLimit result: %s", proc => proc.thread.httptransaction, function() {
  this.thread.httptransaction.capture();
  this.thread.httptransaction = null;
});
logan.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc) {
  trans = this.obj(trans).state("pending").capture();
  if (this.thread.conn_info) {
    this.thread.conn_info.link(trans);
  }
});
logan.rule("nsHttpTransaction::HandleContentStart [this=%p]", function(trans) {
  this.thread.httptransaction = this.obj(trans);
});
logan.ruleIf("http response [", proc => proc.thread.httptransaction, function() {
  this.thread.httptransaction.capture().follow((obj, line) => {
    obj.capture(line);
    return line !== "]";
  });
  this.thread.httptransaction = null;
});
logan.rule("nsHttpTransaction %p SetRequestContext %p", function(trans, rc) {
  this.obj(rc).link(trans);
});
logan.rule("   blocked by request context: [rc=%p trans=%p blockers=%d]", function(rc, trans) {
  this.obj(trans).capture().mention(rc).state("blocked");
});
logan.rule("nsHttpTransaction adding blocking transaction %p from request context %p", function(trans, rc) {
  this.obj(trans).capture().prop("blocking", "true");
});
logan.rule("nsHttpTransaction removing blocking transaction %p from request context %p. %d blockers remain.", function(trans, rc) {
  this.obj(trans).capture().mention(rc);
});
logan.rule("nsHttpConnection::OnHeadersAvailable [this=%p trans=%p response-head=%p]", function(conn, trans) {
  this.obj(trans).capture();
});
logan.rule("nsHttpTransaction %p request context set to null in ReleaseBlockingTransaction() - was %p", function(trans, rc) {
  this.obj(trans).capture().mention(rc);
});
logan.rule("nsHttpTransaction::Close [this=%p reason=%d]", function(trans, status) {
  this.obj(trans).capture().prop("status", status).state("closed");
});
logan.rule("Destroying nsHttpTransaction @%p", function(ptr) {
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpTransaction", ["state", "blocking", "tab-id", "url"]);

/******************************************************************************
 * nsHttpConnection
 ******************************************************************************/

logan.rule("Creating nsHttpConnection @%p", function(ptr) {
  this.obj(ptr).create("nsHttpConnection");
});
logan.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%d]", function(conn, trans, caps) {
  this.obj(conn).capture();
  this.obj(trans).state("active").link(conn);
});
logan.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again) {
  if (parseInt(read) > 0)
    this.obj(conn).state("sent");
});
logan.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn) {
  this.obj(conn).state("recv");
});
logan.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv) {
  this.obj(conn).state("done").capture();
});
logan.rule("Entering Idle Monitoring Mode [this=%p]", function(conn) {
  this.obj(conn).capture().state("idle");
});
logan.rule("nsHttpConnectionMgr::OnMsgReclaimConnection [ent=%p conn=%p]", function(ent, conn) {
  this.thread.httpconnection_reclame = this.obj(conn).capture().mention(ent);
});
logan.rule("Destroying nsHttpConnection @%p", function(ptr) {
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpConnection", ["state"]);

/******************************************************************************
 * nsHalfOpenSocket
 ******************************************************************************/

logan.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s]", function(ptr, trans, ent, host) {
  this.obj(ptr).create("nsHalfOpenSocket");
});
logan.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ptr, end, streamtype) {
  this.thread.halfopen = this.obj(ptr).capture();
});
logan.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", proc => proc.thread.halfopen, function(conn) {
  this.thread.halfopen.link(conn).capture();
  this.thread.halfopen = null;
});
logan.rule("Destroying nsHalfOpenSocket [this=%p]", function(ptr) {
  this.obj(ptr).destroy();
});

/******************************************************************************
 * connection manager
 ******************************************************************************/

logan.rule("nsConnectionEntry::nsConnectionEntry this=%p key=%s", function(ptr, key) {
  this.obj(ptr).create("nsConnectionEntry").alias(key).prop("key", key);
});
logan.rule("nsConnectionEntry::~nsConnectionEntry this=%p", function(ptr, key) {
  this.obj(ptr).destroy();
});
logan.rule("nsHttpConnectionMgr::OnMsgProcessPendingQ [ci=%s]", function(key) {
  if (key === "nullptr") {
    return;
  }
  let connEntry = this.obj(key).capture();
  if (this.thread.httpconnection_reclame) {
    connEntry.mention(this.thread.httpconnection_reclame);
    this.thread.httpconnection_reclame = null;
  }
});
logan.rule("nsHttpConnectionMgr::ProcessPendingQForEntry [ci=%s ent=%p active=%d idle=%d urgent-start-queue=%d queued=%d]", function(ci, ent) {
  let obj = this.obj(ci).capture().follow((obj, line) => {
    if (line.match("done listing")) {
      return false;
    }
    logan.parse(line, "  %p", (trans) => {
      let _trans = logan._proc.obj(trans);
      obj.mention(trans);
    }, (line) => {
      obj.capture(line);
    });
    return true;
  });
});
logan.rule("nsHttpConnectionMgr::TryDispatchTransaction without conn " +
           "[trans=%p halfOpen=%p conn=%p ci=%p ci=%s caps=%x tunnelprovider=%p " +
           "onlyreused=%d active=%u idle=%u]", function(trans, half, conn, ci, ci_key) {
  this.thread.httptransaction = this.obj(trans).capture("Attempt to dispatch on " + ci_key).mention(ci_key);
  this.thread.conn_info = this.obj(ci_key).capture().follow((ci, line) => {
    if (line.match(/^\s\s/)) {
      ci.capture();
      return ci._captured = true;
    }
    if (!ci._captured) {
      return true; // want to find the first line with two spaces
    }
    ci._captured = undefined;
    return false;
  }).mention(trans).mention(conn);
});
logan.summaryProps("nsConnectionEntry", "key");

/******************************************************************************
 * CacheEntry
 ******************************************************************************/

logan.rule("CacheEntry::CacheEntry [this=%p]", function(ptr) {
  this.thread.httpcacheentry = this.obj(ptr).create("CacheEntry");
});
logan.ruleIf("  new entry %p for %*$", proc => proc.thread.httpcacheentry, function(ptr, key) {
  this.thread.httpcacheentry.capture().prop("key", key);
  this.thread.httpcacheentry = null;
});
logan.rule("CacheEntry::AsyncOpen [this=%p, state=%s, flags=%x, callback=%p]", function(entry, state, falgs, cb) {
  entry = this.obj(entry).capture();
});
logan.rule("New CacheEntryHandle %p for entry %p", function(handle, entry) {
  this.obj(entry).capture().alias(handle);
});
logan.rule("CacheEntry::~CacheEntry [this=%p]", function(ptr) {
  this.obj(ptr).destroy();
});
logan.summaryProps("CacheEntry", "key");
