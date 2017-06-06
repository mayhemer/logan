/******************************************************************************
 * HttpChannelParent
 ******************************************************************************/

logan.rule("Creating HttpChannelParent [this=%p]", function(ptr)
{
  this.thread.httpchannelparent = this.create(ptr, "HttpChannelParent");
});
logan.rule("Destroying HttpChannelParent [this=%p]", function(ptr)
{
  this.destroy(ptr);
});

/******************************************************************************
 * nsHttpChannel
 ******************************************************************************/

logan.rule("Creating nsHttpChannel [this=%p]", function(ptr)
{
  this.thread.httpchannel = this.create(ptr, "nsHttpChannel");
  if (this.thread.httpchannelparent) {
    this.link(this.thread.httpchannelparent, this.thread.httpchannel);
  }
});
logan.ruleIf("uri=%s", state => state.thread.httpchannel, function(url)
{
  this.prop(this.thread.httpchannel, "url", url);
});
logan.rule("Destroying nsHttpChannel [this=%p]", function(ptr)
{
  this.destroy(ptr);
});
logan.summaryProps("nsHttpChannel", ["state", "url"]);

/******************************************************************************
 * nsHttpTransaction
 ******************************************************************************/

logan.rule("Creating nsHttpTransaction @%p", function(ptr)
{
  this.thread.httptransaction = this.create(ptr, "nsHttpTransaction");
});
logan.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr)
{
  this.link(ch, tr);
});
logan.ruleIf("http request [", state => state.thread.httptransaction, function()
{
  this.thread.httptransaction._collecting_request = true;
});
logan.plainIf(state => state.thread.httptransaction._collecting_request, function(data)
{
  this.prop(this.thread.httptransaction, "request", data.trim() + "\n", true);
});
logan.ruleIf("]", state => state.thread.httptransaction._collecting_request, function()
{
  this.thread.httptransaction._collecting_request = false;
  this.thread.httptransaction = null;
});
logan.rule("nsHttpConnectionMgr::MakeNewConnection %p ent=%p trans=%p", function(cm, ent, trans)
{
  this.prop(trans, "MakeNewConnection", "1");
});
logan.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc)
{
  this.state(trans, "pending");
});
logan.rule("nsHttpTransaction::HandleContentStart [this=1D7ADC00]", function(trans)
{
  this.state(trans, "has-headers");
  this.thread.httptransaction = trans;
});
logan.ruleIf("http response [", state => state.thread.httptransaction, function()
{
  this.thread.httptransaction._collecting_response = true;
});
logan.plainIf(state => state.thread.httptransaction._collecting_response, function(line)
{
  this.prop(this.thread.httptransaction, "response", line.trim() + "\n", true);
});
logan.ruleIf("]", state => state.thread.httptransaction._collecting_response, function()
{
  this.thread.httptransaction._collecting_response = false;
  this.thread.httptransaction = null;
});
logan.rule("Destroying nsHttpTransaction @%p", function(ptr)
{
  this.destroy(ptr);
});
logan.summaryProps("nsHttpTransaction", ["state"]);

/******************************************************************************
 * nsHttpConnection
 ******************************************************************************/

logan.rule("Creating nsHttpConnection @%p", function(ptr)
{
  this.thread.httpconn = this.create(ptr, "nsHttpConnection");
});
logan.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%d]", function(conn, trans, caps)
{
  this.state(ptr, "activated");
  this.link(trans, conn);
});
logan.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again)
{
  if (parseInt(read) > 0)
    this.state(conn, "sent");
});
logan.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn)
{
  this.state(conn, "recv");
});
logan.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv)
{
  this.state(conn, "done");
  this.prop("CloseTransaction", trans + ":" + rv + "\n", true);
});
logan.rule("Entering Idle Monitoring Mode [this=%p]", function(conn)
{
  this.state(conn, "idle");
});
logan.rule("Destroying nsHttpConnection @%p", function(ptr)
{
  this.destroy(ptr);
});
logan.summaryProps("nsHttpConnection", ["state"]);

/******************************************************************************
 * nsHalfOpenSocket
 ******************************************************************************/

logan.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s:%d]",
  function(ptr, trans, ent, host, port)
  {
    this.create(ptr, "nsHalfOpenSocket");
  });
logan.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ptr, end, stream)
{
  this.thread.halfopen = ptr;
});
logan.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", state => state.thread.halfopen, function(conn)
{
  this.link(this.thread.halfopen, conn);
  this.thread.halfopen = null;
});
logan.rule("Destroying nsHalfOpenSocket [this=%p]", function(ptr)
{
  this.destroy(ptr);
});
