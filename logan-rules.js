logan.schema("moz",
  /^(\d+-\d+-\d+) (\d+:\d+:\d+\.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/,
  (proc, all, date, time, thread, level, module, text) => {
    proc.timestamp = new Date(date + "T" + time + "Z");
    proc.thread = ensure(proc.threads, proc.file.name + "|" + thread, () => new Bag({ name: thread }));
    return [module, text];
  },

  (schema) => {
    schema.module("RequestContext", (module) => {

      /******************************************************************************
       * RequestContext
       ******************************************************************************/

      module.rule("RequestContext::RequestContext this=%p id=%x", function(ptr, id) {
        this.obj(ptr).prop("id", id).create("RequestContext").grep();
      });
      module.rule("RequestContext::RequestContext this=%p blockers=%u", function(ptr) {
        this.obj(ptr).destroy();
      });

    }); // RequestContext

    schema.module("LoadGroup", (module) => {

      /******************************************************************************
       * nsLoadGroup
       ******************************************************************************/

      module.rule("LOADGROUP [%p]: Created.\n", function(ptr) {
        this.obj(ptr).create("nsLoadGroup").prop("requests", 0).prop("foreground-requests", 0).grep();
      });
      module.rule("LOADGROUP [%p]: Destroyed.\n", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("LOADGROUP [%p]: Adding request %p %s (count=%d).\n", function(lg, req, name, count) {
        this.thread.on("httpchannelchild", ch => { ch.alias(req); });
        this.thread.on("wyciwigchild", ch => { ch.alias(req); });

        this.obj(lg).prop("requests", count => ++count).prop("foreground-requests", parseInt(count) + 1).capture().link(req);
        this.obj(req).placeholder("request").prop("in-load-group", lg, true);
      });
      module.rule("LOADGROUP [%p]: Removing request %p %s status %x (count=%d).\n", function(lg, req, name, status, count) {
        this.obj(lg).prop("requests", count => --count).prop("foreground-requests", count).capture().mention(req);
        this.obj(req).prop("in-load-group");
      });
      module.rule("LOADGROUP [%p]: Unable to remove request %p. Not in group!\n", function(lg, req) {
        this.obj(lg).prop("requests", count => ++count).capture();
        this.obj(req).prop("not-found-in-loadgroup", true);
      });
      schema.summaryProps("nsLoadGroup", ["state", "requests", "foreground-requests"]);

    }); // LoadGroup

    schema.module("nsWyciwygChannel", (module) => {

      /******************************************************************************
       * nsWyciwygChannel
       ******************************************************************************/
      module.rule("Creating WyciwygChannelChild @%p\n", function(ptr) {
        this.thread.wyciwigchild = this.obj(ptr).create("WyciwygChannelChild").grep();
      });
      module.rule("WyciwygChannelChild::AsyncOpen [this=%p]\n", function(ptr) {
        this.thread.wyciwigchild = this.obj(ptr).capture();
      });
      module.rule("Destroying WyciwygChannelChild @%p\n", function(ptr) {
        this.obj(ptr).destroy();
      });
    });

    schema.module("nsHttp", (module) => {

      /******************************************************************************
       * HttpChannelChild
       ******************************************************************************/

      module.rule("Creating HttpChannelChild @%p", function(ptr) {
        this.obj(ptr).create("HttpChannelChild").grep();
      });
      module.rule("Destroying HttpChannelChild @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("HttpChannelChild::AsyncOpen [this=%p uri=%s]", function(ptr, uri) {
        this.thread.httpchannelchild = this.obj(ptr).prop("url", uri).state("open").capture();
      });
      module.rule("HttpChannelChild::DoOnStartRequest [this=%p]", function(ptr) {
        this.obj(ptr).state("started").capture();
      });
      module.rule("HttpChannelChild::OnTransportAndData [this=%p]", function(ptr) {
        this.obj(ptr).state("data").capture();
      });
      module.rule("HttpChannelChild::OnStopRequest [this=%p]", function(ptr) {
        this.obj(ptr).state("finished").capture();
      });
      schema.summaryProps("HttpChannelChild", ["state", "url", "status"]);

      /******************************************************************************
       * HttpChannelParent
       ******************************************************************************/

      module.rule("Creating HttpChannelParent [this=%p]", function(ptr) {
        this.thread.httpchannelparent = this.obj(ptr).create("HttpChannelParent").grep();
      });
      module.rule("Destroying HttpChannelParent [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * nsHttpChannel
       ******************************************************************************/

      module.rule("Creating nsHttpChannel [this=%p]", function(ptr) {
        let httpchannel = this.obj(ptr).create("nsHttpChannel").grep().follow("uri=%s", (ch, uri) => {
          ch.prop("url", uri);
        });
        this.thread.on("httpchannelparent", parent => {
          parent.link(httpchannel);
        });
      });
      module.rule("nsHttpChannel::Init [this=%p]", function(ptr) {
        this.thread.httpchannel_init = this.obj(ptr).capture();
      });
      schema.ruleIf("nsHttpChannel::SetupReplacementChannel [this=%p newChannel=%p preserveMethod=%d]",
        proc => proc.thread.httpchannel_init,
        function(oldch, newch, presmethod, channel) {
          this.thread.httpchannel_init = null;
          channel.alias(newch);
          this.obj(oldch).capture().link(newch);
        });
      module.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr) {
        this.obj(ptr).state("open").capture();
      });
      module.rule("nsHttpChannel::Connect [this=%p]", function(ptr) {
        this.obj(ptr).state("connected").capture();
      });
      module.rule("nsHttpChannel::TriggerNetwork [this=%p]", function(ptr) {
        this.obj(ptr).capture().follow(1);
      });
      module.rule("nsHttpChannel::OnCacheEntryCheck enter [channel=%p entry=%p]", function(ch, entry) {
        this.obj(ch).capture().mention(entry).follow((obj) => obj.capture());
      });
      module.rule("nsHTTPChannel::OnCacheEntryCheck exit [this=%p doValidation=%d result=%d]"); // to stop the follow()
      module.rule("nsHttpChannel::OnCacheEntryAvailable [this=%p entry=%p new=%d appcache=%p status=%x mAppCache=%p mAppCacheForWrite=%p]", function(ch, entry, isnew) {
        this.obj(ch).capture().link(entry);
      });
      module.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr) {
        this.obj(ch).capture().link(tr);
        this.obj(tr).prop("url", this.obj(ch).props["url"]);
      });
      module.rule("nsHttpChannel::Starting nsChannelClassifier %p [this=%p]", function(cl, ch) {
        this.obj(ch).capture().link(cl);
      });
      module.rule("nsHttpChannel::ReadFromCache [this=%p] Using cached copy of: %s", function(ptr) {
        this.obj(ptr).prop("from-cache", true).capture();
      });
      module.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).state("started").capture();
      });
      module.rule("nsHttpChannel::OnDataAvailable [this=%p request=%p offset=%d count=%d]", function(ch, pump) {
        this.obj(ch).state("data").capture();
      });
      module.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).prop("status", status).state("finished").capture();
      });
      module.rule("nsHttpChannel::SuspendInternal [this=%p]", function(ptr) {
        this.obj(ptr).prop("suspendcount", suspendcount => ++suspendcount).capture();
      });
      module.rule("nsHttpChannel::ResumeInternal [this=%p]", function(ptr) {
        this.obj(ptr).prop("suspendcount", suspendcount => --suspendcount).capture();
      });
      module.rule("nsHttpChannel::Cancel [this=%p status=%x]", function(ptr, status) {
        this.obj(ptr).state("cancelled").prop("status", status).capture();
      });
      module.rule("Destroying nsHttpChannel [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("nsHttpChannel::ContinueProcessResponse1 [this=%p, rv=%x]", function(ptr) {
        this.thread.httpchannel_for_auth = this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel::ProcessResponse [this=%p httpStatus=%d]", function(ptr, status) {
        this.thread.httpchannel_for_auth = this.obj(ptr).prop("http-status", status, true).capture();
      });
      schema.summaryProps("nsHttpChannel", ["state", "http-status", "url", "status"]);

      /******************************************************************************
       * nsHttpChannelAuthProvider
       ******************************************************************************/

      schema.ruleIf("nsHttpChannelAuthProvider::ProcessAuthentication [this=%p channel=%p code=%u SSLConnectFailed=%d]",
        proc => proc.thread.httpchannel_for_auth, function(ptr, ch, code, sslcon, auth_ch)
      {
        this.thread.httpchannel_for_auth = null;
        this.obj(ptr).placeholder("nsHttpChannelAuthProvider").grep()._channel = auth_ch.alias(ch).capture().link(ptr);
      });
      module.rule("nsHttpChannelAuthProvider::PromptForIdentity [this=%p channel=%p]", function(ptr, ch) {
        this.obj(ptr).capture().on("_channel", ch => ch.prop("asked-credentials", true));
      });

      /******************************************************************************
       * nsHttpTransaction
       ******************************************************************************/

      module.rule("Creating nsHttpTransaction @%p", function(ptr) {
        this.thread.httptransaction = this.obj(ptr).create("nsHttpTransaction").grep();
      });
      module.rule("nsHttpTransaction::Init [this=%p caps=%x]", function(trans) {
        this.obj(trans).capture().follow("  window-id = %x", function(trans, id) {
          trans.prop("tab-id", id);
        });
      });
      schema.ruleIf("http request [", proc => proc.thread.httptransaction, function(trans) {
        this.thread.httptransaction = null;
        trans.capture().follow((trans, line) => {
          trans.capture(line);
          return line !== "]";
        });
      });
      schema.ruleIf("nsHttpConnectionMgr::AtActiveConnectionLimit [ci=%s caps=%d,totalCount=%d, maxPersistConns=%d]",
        proc => proc.thread.httptransaction, function(ci, caps, total, max, trans) {
          trans.capture().mention(ci);
        });
      schema.ruleIf("AtActiveConnectionLimit result: %s", proc => proc.thread.httptransaction, function(atlimit, trans) {
        this.thread.httptransaction = null;
        trans.capture();
      });
      module.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc) {
        trans = this.obj(trans).state("pending").capture();
        this.thread.on("conn_info", conn_info => {
          conn_info.link(trans);
        });
      });
      module.rule("nsHttpTransaction::HandleContentStart [this=%p]", function(trans) {
        this.thread.httptransaction = this.obj(trans);
      });
      schema.ruleIf("http response [", proc => proc.thread.httptransaction, function(trans) {
        this.thread.httptransaction = null;
        trans.capture().follow((trans, line) => {
          trans.capture(line);
          return line !== "]";
        });
      });
      module.rule("nsHttpTransaction %p SetRequestContext %p", function(trans, rc) {
        this.obj(rc).link(trans);
      });
      module.rule("   blocked by request context: [rc=%p trans=%p blockers=%d]", function(rc, trans) {
        this.obj(trans).state("blocked").capture().mention(rc);
      });
      module.rule("nsHttpTransaction adding blocking transaction %p from request context %p", function(trans, rc) {
        this.obj(trans).prop("blocking", "true").capture();
      });
      module.rule("nsHttpTransaction removing blocking transaction %p from request context %p. %d blockers remain.", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpTransaction %p request context set to null in ReleaseBlockingTransaction() - was %p", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpTransaction::Close [this=%p reason=%d]", function(trans, status) {
        this.obj(trans).prop("status", status).state("closed").capture();
      });
      module.rule("Destroying nsHttpTransaction @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      schema.summaryProps("nsHttpTransaction", ["state", "blocking", "tab-id", "url"]);

      /******************************************************************************
       * nsHttpConnection
       ******************************************************************************/

      module.rule("Creating nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).create("nsHttpConnection").grep();
      });
      module.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%x]", function(conn, trans, caps) {
        this.obj(conn).capture();
        this.obj(trans).state("active").capture().link(conn);
      });
      module.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again) {
        if (parseInt(read) > 0)
          this.obj(conn).state("sent").capture();
      });
      module.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn) {
        this.obj(conn).state("recv").capture();
      });
      module.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv) {
        this.obj(conn).state("done").capture().mention(trans);
      });
      module.rule("Entering Idle Monitoring Mode [this=%p]", function(conn) {
        this.obj(conn).state("idle").capture();
      });
      module.rule("nsHttpConnectionMgr::OnMsgReclaimConnection [ent=%p conn=%p]", function(ent, conn) {
        this.thread.httpconnection_reclame = this.obj(conn).capture().mention(ent);
      });
      module.rule("Destroying nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      schema.summaryProps("nsHttpConnection", ["state"]);

      /******************************************************************************
       * Http2Session
       ******************************************************************************/

      module.rule("Http2Session::Http2Session %p serial=%x", function(ptr) {
        this.obj(ptr).create("Http2Session").grep();
      });
      module.rule("Http2Session::~Http2Session %p mDownstreamState=%x", function(ptr) {
        this.obj(ptr).destroy();
      });
      // TODO: Http2Session::AddStream *

      /******************************************************************************
       * Http2Stream
       ******************************************************************************/

      /*
      // needs dtor log first...
      module.rule("Http2Stream::Http2Stream %p", function(ptr) {
        this.obj(ptr).create("Http2Stream").grep();
      });
      */

      /******************************************************************************
       * nsHalfOpenSocket
       ******************************************************************************/

      module.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s]", function(ptr, trans, ent, host) {
        this.obj(ptr).create("nsHalfOpenSocket").grep();
      });
      module.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ptr, end, streamtype) {
        this.thread.halfopen = this.obj(ptr).capture();
      });
      schema.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", proc => proc.thread.halfopen, function(conn, ho) {
        this.thread.halfopen = null;
        ho.link(conn).capture();
      });
      module.rule("Destroying nsHalfOpenSocket [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * connection manager
       ******************************************************************************/

      module.rule("nsConnectionEntry::nsConnectionEntry this=%p key=%s", function(ptr, key) {
        this.obj(ptr).create("nsConnectionEntry").alias(key).prop("key", key);
      });
      module.rule("nsConnectionEntry::~nsConnectionEntry this=%p", function(ptr, key) {
        this.obj(ptr).destroy();
      });
      module.rule("nsHttpConnectionMgr::OnMsgProcessPendingQ [ci=%s]", function(key) {
        if (key === "nullptr") {
          return;
        }
        let connEntry = this.obj(key).capture();
        this.thread.on("httpconnection_reclame", conn => {
          connEntry.mention(conn);
        });
      });
      module.rule("nsHttpConnectionMgr::ProcessPendingQForEntry [ci=%s ent=%p active=%d idle=%d urgent-start-queue=%d queued=%d]", function(ci, ent) {
        this.obj(ci).capture().follow("  %p", (ci, trans) => {
          return ci.mention(trans);
        }, (ci, line) => {
          ci.capture(line);
          return line !== "]";
        });
      });
      module.rule("nsHttpConnectionMgr::TryDispatchTransaction without conn " +
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
            return ci._captured = undefined;
          }).mention(trans).mention(conn);
        });
      schema.summaryProps("nsConnectionEntry", "key");

    }); // nsHttp

    schema.module("cache2", (module) => {

      /******************************************************************************
       * CacheEntry
       ******************************************************************************/

      module.rule("CacheEntry::CacheEntry [this=%p]", function(ptr) {
        this.thread.httpcacheentry = this.obj(ptr).create("CacheEntry").grep();
      });
      schema.ruleIf("  new entry %p for %*$", proc => proc.thread.httpcacheentry, function(ptr, key, entry) {
        this.thread.httpcacheentry = null;
        entry.prop("key", key);
      });
      module.rule("New CacheEntryHandle %p for entry %p", function(handle, entry) {
        this.obj(entry).capture().alias(handle);
      });
      module.rule("CacheEntry::~CacheEntry [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      schema.summaryProps("CacheEntry", "key");

    }); // cache2
  }
); // moz
