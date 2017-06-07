/******************************************************************************
 * HttpChannelParent
 ******************************************************************************/

logan.rule("Creating HttpChannelParent [this=%p]", function(ptr)
{
  this.thread.httpchannelparent = this.obj(ptr).create("HttpChannelParent");
});
logan.rule("Destroying HttpChannelParent [this=%p]", function(ptr)
{
  this.obj(ptr).destroy();
  this.thread.httpchannelparent = null;
});

/******************************************************************************
 * nsHttpChannel
 ******************************************************************************/

logan.rule("Creating nsHttpChannel [this=%p]", function(ptr)
{
  this.thread.httpchannel = this.obj(ptr).create("nsHttpChannel");
  if (this.thread.httpchannelparent) {
    this.thread.httpchannelparent.links(this.thread.httpchannel);
    this.thread.httpchannelparent = null;
  }
});
logan.ruleIf("uri=%s", state => state.thread.httpchannel, function(url)
{
  this.thread.httpchannel.prop("url", url);
  this.thread.httpchannel = null;
});
logan.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr)
{
  this.obj(ptr).state("open").capture();
});
logan.rule("nsHttpChannel::OnProxyAvailable [this=%p pi=%p status=%x mStatus=%x]", function(ptr)
{
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::Connect [this=%p]", function(ptr)
{
  this.obj(ptr).state("connected").capture();
});
logan.rule("nsHttpChannel::OpenCacheEntry [this=%p]", function(ptr)
{
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::OnCacheEntryCheck enter [channel=%p entry=%p]", function(ch, entry)
{
  this.obj(ch).capture().links(entry);
});
logan.rule("nsHTTPChannel::OnCacheEntryCheck exit [this=%p doValidation=%d result=%d]", function(ch, val, result)
{
  this.obj(ch).capture();
});
logan.rule("nsHttpChannel::OnCacheEntryAvailable [this=%p entry=%p new=%d appcache=%p status=%x mAppCache=%p mAppCacheForWrite=%p]", function(ch, entry, isnew)
{
  this.obj(ch).capture().links(entry);
});
logan.rule("nsHttpChannel::TriggerNetwork [this=%p]", function(ptr)
{
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel::SetupTransaction [this=%p]", function(ptr)
{
  this.obj(ptr).capture();
});
logan.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr)
{
  this.obj(ch).capture().links(tr);
});
logan.rule("nsHttpChannel::Starting nsChannelClassifier %p [this=%p]", function(cl, ch)
{
  this.obj(ch).capture().links(cl);
});
logan.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status)
{
  this.obj(ch).capture();
});
logan.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status)
{
  this.obj(ch).capture().prop("status", status);
});
logan.rule("nsHttpChannel::SuspendInternal [this=%p]", function(ptr)
{
  this.obj(ptr).capture().prop("suspendcount", c => ++c);
});
logan.rule("nsHttpChannel::ResumeInternal [this=%p]", function(ptr)
{
  this.obj(ptr).capture().prop("suspendcount", c => --c);
});
logan.rule("nsHttpChannel::Cancel [this=%p status=%x]", function(ptr, status)
{
  this.obj(ptr).capture().state("canceld").prop("status", status);
});
logan.rule("Destroying nsHttpChannel [this=%p]", function(ptr)
{
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpChannel", ["state", "url", "status"]);

/******************************************************************************
 * nsHttpTransaction
 ******************************************************************************/

logan.rule("Creating nsHttpTransaction @%p", function(ptr)
{
  this.thread.httptransaction = this.obj(ptr).create("nsHttpTransaction");
});
logan.ruleIf("http request [", state => state.thread.httptransaction, function()
{
  this.thread.httptransaction.capture()._collecting_request = true;
});
logan.plainIf(state => state.thread.httptransaction && state.thread.httptransaction._collecting_request, function(data)
{
  this.thread.httptransaction.capture(data);
});
logan.ruleIf("]", state => state.thread.httptransaction && state.thread.httptransaction._collecting_request, function()
{
  this.thread.httptransaction.capture()._collecting_request = false;
  this.thread.httptransaction = null;
});
logan.rule("nsHttpConnectionMgr::MakeNewConnection %p ent=%p trans=%p", function(cm, ent, trans)
{
  this.obj(trans).capture();
});
logan.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc)
{
  this.obj(trans).state("pending").capture();
});
logan.rule("nsHttpTransaction::HandleContentStart [this=%p]", function(trans)
{
  this.thread.httptransaction = this.obj(trans).state("has-headers");
});
logan.ruleIf("http response [", state => state.thread.httptransaction, function()
{
  this.thread.httptransaction.capture()._collecting_response = true;
});
logan.plainIf(state => state.thread.httptransaction && state.thread.httptransaction._collecting_response, function(line)
{
  this.thread.httptransaction.capture();
});
logan.ruleIf("]", state => state.thread.httptransaction && state.thread.httptransaction._collecting_response, function()
{
  this.thread.httptransaction.capture()._collecting_response = false;
  this.thread.httptransaction = null;
});
logan.rule("nsHttpTransaction %p SetRequestContext %p", function(trans, context)
{
  this.obj(context).links(trans);
});
logan.rule("   blocked by request context: [rc=%p trans=%p blockers=%d]", function(rc, trans)
{
  this.obj(trans).capture();
});
logan.rule("nsHttpTransaction adding blocking transaction %p from request context %p", function(trans, rc)
{
  this.obj(rc).capture();
  this.obj(trans).prop("blocking", "true");
});
logan.rule("nsHttpTransaction removing blocking transaction %p from request context %p. %d blockers remain.", function(trans, rc)
{
  this.obj(rc).capture();
  this.obj(trans).prop("blocking", undefined);
});
logan.rule("Destroying nsHttpTransaction @%p", function(ptr)
{
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpTransaction", ["state", "blocking"]);

/******************************************************************************
 * nsHttpConnection
 ******************************************************************************/

logan.rule("Creating nsHttpConnection @%p", function(ptr)
{
  this.thread.httpconn = this.obj(ptr).create("nsHttpConnection");
});
logan.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%d]", function(conn, trans, caps)
{
  this.obj(conn).state("activated").capture();
  this.obj(trans).links(conn);
});
logan.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again)
{
  if (parseInt(read) > 0)
    this.obj(conn).state("sent");
});
logan.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn)
{
  this.obj(conn).state("recv");
});
logan.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv)
{
  this.obj(conn).state("done").capture();
});
logan.rule("Entering Idle Monitoring Mode [this=%p]", function(conn)
{
  this.obj(conn).state("idle");
});
logan.rule("Destroying nsHttpConnection @%p", function(ptr)
{
  this.obj(ptr).destroy();
});
logan.summaryProps("nsHttpConnection", ["state"]);

/******************************************************************************
 * nsHalfOpenSocket
 ******************************************************************************/

logan.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s:%d]", function(ptr, trans, ent, host, port)
{
  this.obj(ptr).create("nsHalfOpenSocket");
});
logan.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ptr, end, streamtype)
{
  this.thread.halfopen = this.obj(ptr).capture();
});
logan.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", state => state.thread.halfopen, function(conn)
{
  this.thread.halfopen.links(conn).capture();
  this.thread.halfopen = null;
});
logan.rule("Destroying nsHalfOpenSocket [this=%p]", function(ptr)
{
  this.obj(ptr).destroy();
});
