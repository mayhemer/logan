logan.schema(
  "moz",
  /^(\d+-\d+-\d+) (\d+:\d+:\d+\.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/,
  (proc, all, date, time, thread, level, module, text) => {
    proc.timestamp = new Date(date + "T" + time + "Z");
    proc.thread = ensure(proc.threads, proc.file.name + "|" + thread, { name: thread });
    return [module, text];
  }, 
  (moz) => {
    moz.module("RequestContext", (module) => {
      /******************************************************************************
       * RequestContext
       ******************************************************************************/

      module.rule("RequestContext::RequestContext this=%p id=%x", function(ptr, id) {
        this.obj(ptr).create("RequestContext").prop("id", id);
      });
      module.rule("RequestContext::RequestContext this=%p blockers=%u", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("RequestContext::AddBlockingTransaction this=%p blockers=%u", function(ptr) {
        this.obj(ptr).capture();
      });
      module.rule("RequestContext::RemoveBlockingTransaction this=%p blockers=%u", function(ptr) {
        this.obj(ptr).capture();
      });
    }); // RequestContext

    moz.module("nsHttp", (module) => {
      /******************************************************************************
       * HttpChannelChild
       ******************************************************************************/

      module.rule("Creating HttpChannelChild @%p", function(ptr) {
        this.thread.httpchannelchild = this.obj(ptr).create("HttpChannelChild");
      });
      module.ruleIf("uri=%s", state => state.thread.httpchannelchild, function(uri) {
        this.thread.httpchannelchild.prop("url", uri);
        this.thread.httpchannelchild = null;
      });
      module.rule("Destroying HttpChannelChild @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      moz.summaryProps("HttpChannelChild", ["state", "url", "status"]);

      /******************************************************************************
       * HttpChannelParent
       ******************************************************************************/

      module.rule("Creating HttpChannelParent [this=%p]", function(ptr) {
        this.thread.httpchannelparent = this.obj(ptr).create("HttpChannelParent");
      });
      module.rule("Destroying HttpChannelParent [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * nsHttpChannel
       ******************************************************************************/

      module.rule("Creating nsHttpChannel [this=%p]", function(ptr) {
        this.thread.httpchannel = this.obj(ptr).create("nsHttpChannel");
        if (this.thread.httpchannelparent) {
          this.thread.httpchannelparent.link(this.thread.httpchannel);
          this.thread.httpchannelparent = null;
        }
      });
      module.ruleIf("uri=%s", proc => proc.thread.httpchannel, function(url) {
        this.thread.httpchannel.prop("url", url);
        this.thread.httpchannel = null;
      });
      module.rule("nsHttpChannel::Init [this=%p]", function(ptr) {
        this.thread.httpchannel_init = this.obj(ptr).capture();
      });
      module.ruleIf("nsHttpChannel::SetupReplacementChannel [this=%p newChannel=%p preserveMethod=%d]",
        proc => proc.thread.httpchannel_init,
        function(oldch, newch) {
          this.obj(oldch).capture().link(this.thread.httpchannel_init.alias(newch));
          this.thread.httpchannel_init = null;
        });
      module.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr) {
        this.obj(ptr).state("open").capture();
      });
      module.rule("nsHttpChannel::OnProxyAvailable [this=%p pi=%p status=%x mStatus=%x]", function(ptr) {
        this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel::Connect [this=%p]", function(ptr) {
        this.obj(ptr).state("connected").capture();
      });
      module.rule("nsHttpChannel::OpenCacheEntry [this=%p]", function(ptr) {
        this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel::OnCacheEntryCheck enter [channel=%p entry=%p]", function(ch, entry) {
        this.obj(ch).capture().mention(entry).follow((obj) => obj.capture());
      });
      module.rule("nsHTTPChannel::OnCacheEntryCheck exit [this=%p doValidation=%d result=%d]", function(ch, val, result) {
        this.obj(ch).capture();
      });
      module.rule("nsHttpChannel::OnCacheEntryAvailable [this=%p entry=%p new=%d appcache=%p status=%x mAppCache=%p mAppCacheForWrite=%p]", function(ch, entry, isnew) {
        this.obj(ch).capture().link(entry);
      });
      module.rule("nsHttpChannel::TriggerNetwork [this=%p]", function(ptr) {
        this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel::SetupTransaction [this=%p]", function(ptr) {
        this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr) {
        this.obj(ch).capture().link(tr);
        this.obj(tr).prop("url", this.obj(ch).props["url"]);
      });
      module.rule("nsHttpChannel::Starting nsChannelClassifier %p [this=%p]", function(cl, ch) {
        this.obj(ch).capture().link(cl);
      });
      module.rule("nsHttpChannel::ReadFromCache [this=%p] Using cached copy of: %s", function(ptr) {
        this.obj(ptr).capture().prop("from-cache", true);
      });
      module.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).capture().state("started");
      });
      module.rule("nsHttpChannel::OnDataAvailable [this=%p request=%p offset=%d count=%d]", function(ch, pump) {
        this.obj(ch).capture().state("data");
      });
      module.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).capture().prop("status", status).state("finished");
      });
      module.rule("nsHttpChannel::SuspendInternal [this=%p]", function(ptr) {
        this.obj(ptr).capture().prop("suspendcount", c => ++c);
      });
      module.rule("nsHttpChannel::ResumeInternal [this=%p]", function(ptr) {
        this.obj(ptr).capture().prop("suspendcount", c => --c);
      });
      module.rule("nsHttpChannel::Cancel [this=%p status=%x]", function(ptr, status) {
        this.obj(ptr).capture().state("cancelled").prop("status", status);
      });
      module.rule("Destroying nsHttpChannel [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      moz.summaryProps("nsHttpChannel", ["state", "url", "status"]);

      /******************************************************************************
       * nsHttpTransaction
       ******************************************************************************/

      module.rule("Creating nsHttpTransaction @%p", function(ptr) {
        this.thread.httptransaction = this.obj(ptr).create("nsHttpTransaction");
      });
      module.rule("nsHttpTransaction::Init [this=%p caps=%x]", function(trans) {
        this.obj(trans).follow((trans, line) => {
          logan.parse(line, "  window-id = %x", function(id) {
            trans.prop("tab-id", id);
          });
        });
      });
      module.ruleIf("http request [", proc => proc.thread.httptransaction, function() {
        this.thread.httptransaction.capture().follow((obj, line) => {
          obj.capture(line);
          return line !== "]";
        });
        this.thread.httptransaction = null;
      });
      module.ruleIf("nsHttpConnectionMgr::AtActiveConnectionLimit [ci=%s caps=%d,totalCount=%d, maxPersistConns=%d]",
        proc => proc.thread.httptransaction, function(ci) {
          this.thread.httptransaction.capture().mention(ci);
        });
      module.ruleIf("AtActiveConnectionLimit result: %s", proc => proc.thread.httptransaction, function() {
        this.thread.httptransaction.capture();
        this.thread.httptransaction = null;
      });
      module.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc) {
        trans = this.obj(trans).state("pending").capture();
        if (this.thread.conn_info) {
          this.thread.conn_info.link(trans);
        }
      });
      module.rule("nsHttpTransaction::HandleContentStart [this=%p]", function(trans) {
        this.thread.httptransaction = this.obj(trans);
      });
      module.ruleIf("http response [", proc => proc.thread.httptransaction, function() {
        this.thread.httptransaction.capture().follow((obj, line) => {
          obj.capture(line);
          return line !== "]";
        });
        this.thread.httptransaction = null;
      });
      module.rule("nsHttpTransaction %p SetRequestContext %p", function(trans, rc) {
        this.obj(rc).link(trans);
      });
      module.rule("   blocked by request context: [rc=%p trans=%p blockers=%d]", function(rc, trans) {
        this.obj(trans).capture().mention(rc).state("blocked");
      });
      module.rule("nsHttpTransaction adding blocking transaction %p from request context %p", function(trans, rc) {
        this.obj(trans).capture().prop("blocking", "true");
      });
      module.rule("nsHttpTransaction removing blocking transaction %p from request context %p. %d blockers remain.", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpConnection::OnHeadersAvailable [this=%p trans=%p response-head=%p]", function(conn, trans) {
        this.obj(trans).capture();
      });
      module.rule("nsHttpTransaction %p request context set to null in ReleaseBlockingTransaction() - was %p", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpTransaction::Close [this=%p reason=%d]", function(trans, status) {
        this.obj(trans).capture().prop("status", status).state("closed");
      });
      module.rule("Destroying nsHttpTransaction @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      moz.summaryProps("nsHttpTransaction", ["state", "blocking", "tab-id", "url"]);

      /******************************************************************************
       * nsHttpConnection
       ******************************************************************************/

      module.rule("Creating nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).create("nsHttpConnection");
      });
      module.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%d]", function(conn, trans, caps) {
        this.obj(conn).capture();
        this.obj(trans).state("active").link(conn);
      });
      module.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again) {
        if (parseInt(read) > 0)
          this.obj(conn).state("sent");
      });
      module.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn) {
        this.obj(conn).state("recv");
      });
      module.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv) {
        this.obj(conn).state("done").capture();
      });
      module.rule("Entering Idle Monitoring Mode [this=%p]", function(conn) {
        this.obj(conn).capture().state("idle");
      });
      module.rule("nsHttpConnectionMgr::OnMsgReclaimConnection [ent=%p conn=%p]", function(ent, conn) {
        this.thread.httpconnection_reclame = this.obj(conn).capture().mention(ent);
      });
      module.rule("Destroying nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      moz.summaryProps("nsHttpConnection", ["state"]);

      /******************************************************************************
       * nsHalfOpenSocket
       ******************************************************************************/

      module.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s]", function(ptr, trans, ent, host) {
        this.obj(ptr).create("nsHalfOpenSocket");
      });
      module.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ptr, end, streamtype) {
        this.thread.halfopen = this.obj(ptr).capture();
      });
      module.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", proc => proc.thread.halfopen, function(conn) {
        this.thread.halfopen.link(conn).capture();
        this.thread.halfopen = null;
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
        if (this.thread.httpconnection_reclame) {
          connEntry.mention(this.thread.httpconnection_reclame);
          this.thread.httpconnection_reclame = null;
        }
      });
      module.rule("nsHttpConnectionMgr::ProcessPendingQForEntry [ci=%s ent=%p active=%d idle=%d urgent-start-queue=%d queued=%d]", function(ci, ent) {
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
            ci._captured = undefined;
            return false;
          }).mention(trans).mention(conn);
        });
      moz.summaryProps("nsConnectionEntry", "key");
    }); // nsHttp

    moz.module("cache2", (module) => {
      /******************************************************************************
       * CacheEntry
       ******************************************************************************/

      module.rule("CacheEntry::CacheEntry [this=%p]", function(ptr) {
        this.thread.httpcacheentry = this.obj(ptr).create("CacheEntry");
      });
      module.ruleIf("  new entry %p for %*$", proc => proc.thread.httpcacheentry, function(ptr, key) {
        this.thread.httpcacheentry.prop("key", key);
        this.thread.httpcacheentry = null;
      });
      module.rule("CacheEntry::AsyncOpen [this=%p, state=%s, flags=%x, callback=%p]", function(entry, state, falgs, cb) {
        this.obj(entry).capture();
      });
      module.rule("New CacheEntryHandle %p for entry %p", function(handle, entry) {
        this.obj(entry).capture().alias(handle);
      });
      module.rule("CacheEntry::~CacheEntry [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      moz.summaryProps("CacheEntry", "key");
    }); // cache2
  }
); // moz
