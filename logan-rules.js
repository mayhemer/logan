logan.schema("MOZ_LOG",
  (line, proc) => {
    let match;

    /* 2018-02-05 16:38:27.269000 UTC - [7912:Socket Thread]: V/nsHttp nsHttpTransaction::WriteSegments 000001E7DD4AFC00 */
    match = line.match(/^(\d+-\d+-\d+) (\d+:\d+:\d+\.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/);
    if (match) {
      let [all, date, time, thread, level, module, text] = match;
      return {
        text: text,
        timestamp: new Date(date + "T" + time + "Z"),
        threadname: thread,
        module: module,
      };
    }

    /* [7912:Socket Thread]: V/nsHttp nsHttpTransaction::WriteSegments 000001E7DD4AFC00 */
    match = line.match(/^\[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/);
    if (match) {
      let [all, thread, level, module, text] = match;
      return {
        text: text,
        threadname: thread,
        module: module,
      };
    }

    return undefined; // just express it explicitly
  },

  (schema) => {
    schema.COS = new Flags({
      Leader: 1 << 0,
      Follower: 1 << 1,
      Speculative: 1 << 2,
      Background: 1 << 3,
      Unblocked: 1 << 4,
      Throttleable: 1 << 5,
      UrgentStart: 1 << 6,
      DontThrottle: 1 << 7,
      Tail: 1 << 8,
      TailAllowed: 1 << 9,
      TailForbidden: 1 << 10,
    });

    schema.NET_STATUS = new Enum({
      STATUS_READING: 0x804B0008,
      STATUS_WRITING: 0x804B0009,
      STATUS_RESOLVING: 0x804b0003,
      STATUS_RESOLVED: 0x804b000b,
      STATUS_CONNECTING_TO: 0x804b0007,
      STATUS_CONNECTED_TO: 0x804b0004,
      STATUS_TLS_HANDSHAKE_STARTING: 0x804B000C,
      STATUS_TLS_HANDSHAKE_ENDED: 0x804B000D,
      STATUS_SENDING_TO: 0x804b0005,
      STATUS_WAITING_FOR: 0x804b000a,
      STATUS_RECEIVING_FROM: 0x804b0006,
    });

    schema.SOCK_CONN_FLAGS = new Flags({
      BYPASS_CACHE: 1 << 0,
      ANONYMOUS_CONNECT: 1 << 1,
      DISABLE_IPV6: 1 << 2,
      NO_PERMANENT_STORAGE: 1 << 3,
      DISABLE_IPV4: 1 << 4,
      DISABLE_RFC1918: 1 << 5,
      MITM_OK: 1 << 6,
      BE_CONSERVATIVE: 1 << 7,
      DISABLE_TRR: 1 << 8,
      REFRESH_CACHE: 1 << 9,
      RETRY_WITH_DIFFERENT_IP_FAMILY: 1 << 10,
    });

    schema.H2STREAM_STATE = new Enum({
      GENERATING_HEADERS: 0,
      GENERATING_BODY: 1,
      SENDING_BODY: 2,
      SENDING_FIN_STREAM: 3,
      UPSTREAM_COMPLETE: 4,
    });

    schema.H2SESSION_STATE = new Enum({
      BUFFERING_OPENING_SETTINGS: 0,
      BUFFERING_FRAME_HEADER: 1,
      BUFFERING_CONTROL_FRAME: 2,
      PROCESSING_DATA_FRAME_PADDING_CONTROL: 3,
      PROCESSING_DATA_FRAME: 4,
      DISCARDING_DATA_FRAME_PADDING: 5,
      DISCARDING_DATA_FRAME: 6,
      PROCESSING_COMPLETE_HEADERS: 7,
      PROCESSING_CONTROL_RST_STREAM: 8,
      NOT_USING_NETWORK: 9,
    });

    schema.module("DocumentLeak", (module) => {

      /******************************************************************************
       * nsDocument
       ******************************************************************************/

      module.rule("DOCUMENT %p created", function(doc) {
        this.obj(doc).create("nsDocument").grep();
      });
      module.rule("DOCUMENT %p destroyed", function(doc) {
        this.obj(doc).destroy();
      });
      module.rule("DOCUMENT %p UnblockDOMContentLoaded", function(doc) {
        doc = this.obj(doc).capture();
        netcap(n => { n.DOMContentLoaded(doc.docshell) });
      });
      module.rule("DOCUMENT %p with PressShell %p and DocShell %p", function(doc, presshell, docshell) {
        this.thread.on("docshell", ds => {
          docshell = ds.alias(docshell);
        }, () => {
          docshell = this.obj(docshell);
        });
        this.obj(presshell).link(docshell).docshell = docshell;
        this.obj(doc).link(docshell).docshell = docshell;
      });

    }); // DocumentLeak

    schema.module("PresShell", (module) => {

      /******************************************************************************
       * PresShell
       ******************************************************************************/

      module.rule("PresShell::PresShell this=%p", function(ps) {
        this.obj(ps).create("PresShell");
      });
      module.rule("PresShell::~PresShell this=%p", function(ps) {
        this.obj(ps).destroy();
      });
      module.rule("PresShell::Initialize this=%p", function(ps) {
        this.obj(ps).__init_time = this.timestamp;
      });
      module.rule("PresShell::ScheduleBeforeFirstPaint this=%p", function(ps) {
        ps = this.obj(ps).prop("first-paint-time-ms", (val, ps) => this.duration(ps.__init_time)).capture();
        netcap(n => { n.FirstPaint(ps.docshell) });
      });
    }); // PresShell

    schema.module("DocLoader", (module) => {

      /******************************************************************************
       * nsDocLoader
       ******************************************************************************/

      module.rule("DocLoader:%p: created.\n", function(docloader) {
        // This DocLoader is aliased to DocShell
        this.thread.docloader = docloader;
      });
      module.rule("DocLoader:%p: load group %p.\n", function(docloader, loadgroup) {
        docloader = this.objIf(docloader).capture().link(loadgroup);
        loadgroup = this.obj(loadgroup);
        docloader.loadgroup = loadgroup;
        loadgroup.docshell = docloader;
      });

    }); // DocLoader

    schema.module("nsDocShellLeak", (module) => {

      /******************************************************************************
       * nsDocShell
       ******************************************************************************/

      module.rule("DOCSHELL %p created\n", function(docshell) {
        docshell = this.obj(docshell).create("nsDocShell");
        this.thread.on("docloader", dl => {
          docshell.alias(dl);
        });
      });
      module.rule("DOCSHELL %p destroyed\n", function(docshell) {
        this.obj(docshell).destroy();
      });
      module.rule("nsDocShell[%p]: loading %s with flags 0x%08x", function(docshell, url, flags) {
        docshell = this.obj(docshell).prop("url", url, true).capture();
        netcap(n => { n.topload(docshell, url) });
      });
      module.rule("DOCSHELL %p SetCurrentURI %s\n", function(docshell, url) {
        this.thread.docshell = this.obj(docshell).capture();
      });
      logan.summaryProps("nsDocShell", ["url"]);

    }); // nsDocShellLeak

    schema.module("RequestContext", (module) => {

      /******************************************************************************
       * RequestContext
       ******************************************************************************/

      module.rule("RequestContext::RequestContext this=%p id=%x", function(ptr, id) {
        this.obj(ptr).create("RequestContext").prop("id", id).grep();
        this.thread.on("loadgroup", (lg) => {
          lg.prop("rc-id", id);
        });
      });
      module.rule("RequestContext::~RequestContext this=%p blockers=%u", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("RequestContext::IsContextTailBlocked this=%p, request=%p, queued=%u", function(rc, req, queued) {
        this.thread.on("tail_request", (tail) => {
          tail.alias(req);
        });
        this.obj(rc).capture().follow(1);
      });
      module.rule("RequestContext::CancelTailedRequest %p req=%p removed=%d", function(rc, req) {
        this.obj(rc).capture();
      });
      module.rule("RequestContext::RemoveNonTailRequest this=%p, cnt=%d", function(rc, cnt) {
        rc = this.obj(rc).capture();
        this.thread.on("tail_request", (ch) => (rc.mention(ch), ch));
      });
      module.rule("RequestContext::AddNonTailRequest this=%p, cnt=%d", function(rc, cnt) {
        rc = this.obj(rc).capture();
        this.thread.on("tail_request", (ch) => (rc.mention(ch), ch));
      });
      logan.summaryProps("RequestContext", []);

    }); // RequestContext

    schema.module("LoadGroup", (module) => {

      /******************************************************************************
       * nsLoadGroup
       ******************************************************************************/

      module.rule("LOADGROUP [%p]: Created.\n", function(ptr) {
        this.thread.loadgroup = this.obj(ptr).create("nsLoadGroup").grep().prop("requests", 0);
      });
      module.rule("LOADGROUP [%p]: Destroyed.\n", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("LOADGROUP [%p]: Adding request %p %s (count=%d).\n", function(lg, req, name) {
        this.thread.on("httpchannelchild", ch => { ch.alias(req); });
        this.thread.on("wyciwigchild", ch => { ch.alias(req); });
        this.thread.on("imagerequestproxy", ch => { ch.alias(req); });
        this.thread.on("imagerequest", ch => { ch.alias(req); });

        this.obj(req).class("unknown request").prop("in-load-group", lg, true).grep();
        this.obj(lg).prop("requests", count => ++count).capture().link(req);
      });
      module.rule("LOADGROUP [%p]: Removing request %p %s status %x (count=%d).\n", function(lg, req, name, status) {
        this.obj(req).class("unknown request").prop("in-load-group");
        this.obj(lg).prop("requests", count => --count).capture();
      });
      module.rule("LOADGROUP [%p]: Unable to remove request %p. Not in group!\n", function(lg, req) {
        this.obj(req).class("unknown request").prop("not-found-in-loadgroup", true);
        this.obj(lg).prop("requests", count => ++count).capture();
      });
      module.rule("LOADGROUP [%p]: Firing OnStartRequest for request %p.(foreground count=%d).\n", function(lg, req, fgcnt) {
        this.obj(lg).prop("foreground-requests", fgcnt).capture();
      });
      module.rule("LOADGROUP [%p]: Firing OnStopRequest for request %p.(foreground count=%d).\n", function(lg, req, fgcnt) {
        this.obj(lg).prop("foreground-requests", fgcnt).capture();
      });
      module.rule("nsLoadGroup::SetDefaultLoadRequest this=%p default-request=%p", function(lg, req) {
        // Note that the request is already aliased, since AddRequest is called before SetDefault..
        req = this.obj(req).class("unknown default request");
        if (!req.nullptr) {
          this.obj(lg).prop("default-url", req.props.url, true).capture().link(req);
        }
      });
      module.rule("nsLoadGroup::OnEndPageLoad this=%p default-request=%p", function(lg, dch) {
        lg = this.obj(lg).capture();
        netcap(n => { n.EndPageLoad(lg) });
      });
      logan.summaryProps("nsLoadGroup", ["requests", "foreground-requests"]);

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

    schema.module("imgRequest", (module) => {

      /******************************************************************************
       * imgLoader
       ******************************************************************************/

      module.rule("%d [this=%p] imgLoader::LoadImage (aURI=\"%s\") {ENTER}", function(now, ptr, uri) {
        this.thread.load_image_uri = uri;
        delete this.thread.httpchannelchild;
      });
      module.rule("%d [this=%p] imgLoader::LoadImage {EXIT}", function(now, ptr) {
        delete this.thread.load_image_uri;
      });
      module.rule("%d [this=%p] imgLoader::LoadImage |cache hit| (request=\"%p\")", function(now, ptr, request) {
        this.obj(request).prop("cache-hit", true).capture();
      });
      module.rule("[this=%p] imgLoader::LoadImage -- Created new imgRequest [request=%p]", function(ptr, request) {
        this.thread.on("httpchannelchild", (ch) => {
          this.obj(request).capture().link(ch);
          return ch;
        });
      });

      /******************************************************************************
       * imgRequest
       ******************************************************************************/

      module.rule("%d [this=%p] imgRequest::imgRequest()", function(now, ptr) {
        this.thread.imagerequest = this.obj(ptr).create("imgRequest")
          .prop("url", this.thread.load_image_uri)
          .grep();
      });
      module.rule("%d [this=%p] imgRequest::Init", function(now, ptr) {
        this.obj(ptr).capture().__opentime = this.timestamp;
      });
      module.rule("%d [this=%p] imgRequest::AddProxy (proxy=%p) {ENTER}", function(now, ptr, proxy) {
        this.obj(ptr).capture();
        this.obj(proxy).link(ptr);
      });
      module.rule("[this=%p] imgRequest::BoostPriority for category %x", function(ptr, cat) {
        this.obj(ptr)
          .prop("priority-boost-cat", cat, true)
          .propIf("priority-boost-too-late", cat, obj => "open-to-first-data" in obj.props, true)
          .capture();
      });
      module.rule("%d [this=%p] imgRequest::OnDataAvailable (count=\"%d\") {ENTER}", function(now, ptr, count) {
        this.obj(ptr).propIfNull("open-to-first-data", (val, request) => this.duration(request.__opentime)).capture();
      });
      module.rule("%d [this=%p] imgRequest::OnStopRequest", function(now, ptr) {
        this.obj(ptr).prop("open-to-stop", (val, request) => this.duration(request.__opentime)).capture();
      });
      module.rule("%d [this=%p] imgRequest::~imgRequest() (keyuri=\"%s\")", function(now, ptr, key) {
        this.obj(ptr).destroy();
      });
      module.rule("%d [this=%p] imgRequest::~imgRequest()", function(now, ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("imgRequest", ["url"]);

      /******************************************************************************
       * imgRequestProxy
       ******************************************************************************/

      module.rule("%d [this=%p] imgRequestProxy::imgRequestProxy", function(now, ptr) {
        this.thread.imagerequestproxy = this.obj(ptr).create("imgRequestProxy").grep();
      });
      module.rule("%d [this=%p] imgRequestProxy::~imgRequestProxy", function(now, ptr) {
        this.obj(ptr).destroy();
      });

    }); // imageRequest

    schema.module("ScriptLoader", (module) => {

      /******************************************************************************
       * ScriptLoader / ScriptLoadRequest
       ******************************************************************************/

      module.rule("ScriptLoader::ScriptLoader %p", function(loader) {
        this.obj(loader).create("ScriptLoader").grep();
      });
      module.rule("ScriptLoader::~ScriptLoader %p", function(loader) {
        this.obj(loader).destroy();
      });
      module.rule("ScriptLoader %p creates ScriptLoadRequest %p", function(loader, request) {
        this.obj(loader).capture().link(this.obj(request).create("ScriptLoadRequest").grep());
      });
      module.rule("ScriptLoadRequest (%p): Start Load (url = %s)", function(request, url) {
        this.obj(request).capture().prop("url", url);
      });
      module.rule("ScriptLoadRequest (%p): async=%d defer=% tracking=%d", function(request, async, defer, tracking) {
        this.obj(request).capture().prop("async", async).prop("defer", defer).prop("tracking", tracking);
      });
      logan.summaryProps("ScriptLoadRequest", ["url"]);

    }); // ScriptLoader

    schema.module("nsChannelClassifier", (module) => {

      /******************************************************************************
       * nsChannelClassifier
       ******************************************************************************/

      module.rule("nsChannelClassifier::nsChannelClassifier %p", function(clas) {
        this.obj(clas).create("nsChannelClassifier").grep();
      });
      module.rule("nsChannelClassifier::~nsChannelClassifier %p", function(clas) {
        this.obj(clas).destroy();
      });
      // ESR 52 compat
      module.rule("nsChannelClassifier[%p]%*$", function(clas) {
        this.obj(clas).class("nsChannelClassifier").capture();
      });
      module.rule("nsChannelClassifier::%s[%p]%*$", function(method, clas) {
        this.obj(clas).class("nsChannelClassifier").capture();
      });

    });

    schema.module("nsHttp", (module) => {

      /******************************************************************************
       * HttpChannelChild
       ******************************************************************************/

      module.rule("Creating HttpChannelChild @%p", function(ptr) {
        this.thread.httpchannelchild = this.obj(ptr).create("HttpChannelChild").grep()
          .expect("uri=%s", (ch, uri) => { ch.prop("url", uri); });
      });
      module.rule("Destroying HttpChannelChild @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("HttpChannelChild::AsyncOpen [this=%p uri=%s]", function(ptr, uri) {
        this.thread.httpchannelchild = this.obj(ptr).state("open").capture();
      });
      module.rule("HttpChannelChild::ContinueAsyncOpen this=%p gid=%u topwinid=%x", function(ch, gid, winid) {
        this.obj(ch).prop("top-win-id", winid).capture().ipcid(gid).send("HttpChannel");
      });
      module.rule("HttpChannelChild::ConnectParent [this=%p, id=%u]\n", function(ch, id) {
        this.obj(ch).capture().ipcid(id).send("HttpChannel::ConnectParent");
      });
      module.rule("HttpChannelChild::DoOnStartRequest [this=%p]", function(ptr) {
        this.obj(ptr).recv("HttpChannel::Start", ch => {
          ch.state("started").capture();
        });
      });
      module.rule("HttpChannelChild::OnTransportAndData [this=%p]", function(ptr) {
        this.obj(ptr).recv("HttpChannel::Data", ch => {
          ch.state("data").capture();
        });
      });
      module.rule("HttpChannelChild::OnStopRequest [this=%p status=%x]", function(ptr, status) {
        this.obj(ptr).recv("HttpChannel::Stop", ch => {
          ch.state("finished").prop("status", status).capture();
        });
      });
      module.rule("HttpChannelChild %p ClassOfService=%u", function(ch, cos) {
        ch = this.obj(ch).capture();
        netcap(n => { n.channelCOS(ch, parseInt(cos)) });
      });
      module.rule("HttpChannelChild::SetPriority %p p=%d", function(ch, prio) {
        ch = this.obj(ch).capture();
        netcap(n => { n.channelPrio(ch, parseInt(prio)) });
      });
      logan.summaryProps("HttpChannelChild", ["url", "status"]);

      /******************************************************************************
       * HttpChannelParent
       ******************************************************************************/

      module.rule("Creating HttpChannelParent [this=%p]", function(ptr) {
        this.thread.httpchannelparent = this.obj(ptr).create("HttpChannelParent").grep();
      });
      module.rule("HttpChannelParent RecvAsyncOpen [this=%p uri=%s, gid=%u topwinid=%x]\n", function(parent, uri, gid, winid) {
        this.obj(parent).capture().ipcid(gid).recv("HttpChannel", (parent, child) => {
          parent.httpchannelchild = child.link(parent);
        });
      });
      module.rule("HttpChannelParent::ConnectChannel: Looking for a registered channel [this=%p, id=%u]", function(ch, id) {
        ch = this.obj(ch);
        if (ch === this.thread.httpchannelparent) {
          // This would otherwise leak to a following nsHttpChannel incorrectly
          delete this.thread.httpchannelparent;
        }
        ch.ipcid(id).capture().recv("HttpChannel::ConnectParent", (parent, child) => {
          parent.httpchannelchild = child.link(parent);
        }).follow("  and it is %/HttpBaseChannel|nsHttpChannel/r %p", function(parent, ignore, httpch) {
          parent.capture().link(this.obj(httpch).ipcid(parent.ipcid()));
        });
      });
      module.rule("HttpChannelParent::OnStopRequest: [this=%p aRequest=%p status=%x]", function(parent, req) {
        this.obj(parent).capture().send("HttpChannel::Stop");
      });
      module.rule("Destroying HttpChannelParent [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * HttpChannelParentListener
       ******************************************************************************/

      module.rule("HttpChannelParentListener::HttpChannelParentListener [this=%p, next=%p]", function(listener, nextlistener) {
        this.obj(listener).create("HttpChannelParentListener").link(nextlistener).grep();
      });
      module.rule("HttpChannelParentListener::~HttpChannelParentListener %p", function(listener) {
        this.obj(listener).destroy();
      });

      /******************************************************************************
       * nsHttpChannel
       ******************************************************************************/

      module.rule("Creating nsHttpChannel [this=%p]", function(ch) {
        ch = this.obj(ch).create("nsHttpChannel").grep().expect("uri=%s", (ch, uri) => {
          ch.prop("url", uri).capture();
        });
        this.thread.on("httpchannelparent", parent => {
          ch.ipcid(parent.ipcid());
          parent.link(ch);
          ch.httpparentchannel = parent;
        });
      });
      module.rule("Destroying nsHttpChannel [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("nsHttpChannel::Init [this=%p]", function(ptr) {
        this.thread.httpchannel_init = this.obj(ptr).capture();
      });
      module.ruleIf("nsHttpChannel::SetupReplacementChannel [this=%p newChannel=%p preserveMethod=%d]",
        proc => proc.thread.httpchannel_init,
        function(oldch, newch, presmethod, channel) {
          delete this.thread.httpchannel_init;
          channel.alias(newch);
          this.obj(oldch).capture().link(newch);
        });
      module.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr) {
        let channel = this.obj(ptr).state("open").capture();
        channel.__opentime = this.timestamp;
        if (this.thread.httpchannel_init === channel) {
          delete this.thread.httpchannel_init;
        }
        netcap(n => { n.channelAsyncOpen(channel) });
      });
      module.rule("nsHttpChannel [%p] created nsChannelClassifier [%p]", function(ch, clas) {
        this.obj(ch).link(clas).capture();
      });
      module.rule("nsHttpChannel::Connect [this=%p]", function(ptr) {
        this.obj(ptr).state("connected").capture();
      });
      module.rule("nsHttpChannel::ContinueBeginConnectWithResult [this=%p]", function(ch) {
        this.thread.httpchannel = this.obj(ch).capture();
      });
      module.rule("nsHttpChannel::Connect() STS permissions found", function(ch) {
        this.thread.on("httpchannel", ch => {
          ch.prop("sts-found", true).capture();
        });
      });
      module.rule("nsHttpChannel::ContinueBeginConnectWithResult result [this=%p rv=%x mCanceled=%d]", function(ch) {
        delete this.thread.httpchannel;
        this.obj(ch).capture();
      });
      module.rule("nsHttpChannel::OpenCacheEntry [this=%p]", function(ch) {
        this.thread.cacheentryconsumer = this.obj(ch).capture();
      });
      module.rule("nsHttpChannel::TriggerNetwork [this=%p]", function(ptr) {
        delete this.thread.cacheentryconsumer;
        this.obj(ptr).capture().follow(1);
      });
      module.rule("nsHttpChannel::OnCacheEntryCheck enter [channel=%p entry=%p]", function(ch, entry) {
        this.obj(ch).capture().mention(entry).follow(
          "nsHTTPChannel::OnCacheEntryCheck exit [this=%p doValidation=%d result=%d]", (obj, ptr, doValidation) => {
            obj.capture().prop("revalidates-cache", doValidation);
          },
          obj => obj.capture()
        );
      });
      module.rule("nsHttpChannel::OnCacheEntryAvailable [this=%p entry=%p new=%d appcache=%p status=%x mAppCache=%p mAppCacheForWrite=%p]", function(ch, entry, isnew) {
        this.obj(ch).capture().link(entry);
      });
      module.rule("nsHttpChannel::SetupTransaction [this=%p, cos=%u, prio=%d]\n", function(ch, cos, prio) {
        ch = this.obj(ch).prop("cos-before-trans-open", cos).prop("priority-before-trans-open", prio).capture();
        netcap(n => { n.channelCOS(ch, parseInt(cos)) });
        netcap(n => { n.channelPrio(ch, parseInt(prio)) });
      });
      module.rule("nsHttpChannel %p created nsHttpTransaction %p", function(ch, tr) {
        ch = this.obj(ch).capture().link(tr = this.obj(tr).prop("url", this.obj(ch).props["url"]));
        tr.httpchannel = ch;
        netcap(n => { n.channelCreatesTrans(ch, tr) });
      });
      module.rule("nsHttpChannel::Starting nsChannelClassifier %p [this=%p]", function(cl, ch) {
        this.obj(ch).capture().link(this.obj(cl).class("nsChannelClassifier")).__classifystarttime = this.timestamp;
      });
      module.rule("nsHttpChannel::ReadFromCache [this=%p] Using cached copy of: %s", function(ptr) {
        this.obj(ptr).prop("from-cache", true).capture();
      });
      module.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).class("nsHttpChannel")
          .prop("start-time", (val, ch) => this.duration(ch.__opentime))
          .state("started")
          .capture();
      });
      module.rule("HttpBaseChannel::DoApplyContentConversions [this=%p]", function(ch) {
        this.thread.httpchannel_applying_conv = this.obj(ch).capture();
      });
      module.rule("nsHttpChannel::CallOnStartRequest [this=%p]", function(ch) {
        this.thread.httpchannel_applying_conv = this.obj(ch).capture();
      });
      module.rule("  calling mListener->OnStartRequest by ScopeExit [this=%p, listener=%p]\n", function(ch) {
        this.obj(ch).capture().send("HttpChannel::Start");
        this.thread.httpchannel_applying_conv = null;
      });
      module.rule("  calling mListener->OnStartRequest [this=%p, listener=%p]\n", function(ch) {
        this.obj(ch).capture().send("HttpChannel::Start");
        this.thread.httpchannel_applying_conv = null;
      });
      module.rule("HttpBaseChannel::DoNotifyListener this=%p", function(ch) {
        this.obj(ch).capture().send("HttpChannel::Start");
      });
      module.rule("nsHttpChannel::OnDataAvailable [this=%p request=%p offset=%d count=%d]", function(ch, pump) {
        this.obj(ch).class("nsHttpChannel")
          .propIfNull("first-data-time", (val, ch) => this.duration(ch.__opentime))
          .prop("last-data-time", (val, ch) => this.duration(ch.__opentime))
          .state("data")
          .capture()
          .send("HttpChannel::Data");
      });
      module.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        this.obj(ch).class("nsHttpChannel")
          .state("on-stop")
          .prop("status", status, true)
          .prop("stop-time", (val, ch) => this.duration(ch.__opentime))
          .capture();
      });
      module.rule("nsHttpChannel %p calling OnStopRequest\n", function(ch) {
        ch = this.obj(ch).state("finished").capture();
        netcap(n => { n.channelDone(ch) });
      });
      module.rule("nsHttpChannel::SuspendInternal [this=%p]", function(ch) {
        ch = this.obj(ch).prop("suspendcount", suspendcount => ++suspendcount).capture();
        netcap(n => { n.channelSuspend(ch) });
      });
      module.rule("nsHttpChannel::ResumeInternal [this=%p]", function(ch) {
        ch = this
          .obj(ch)
          .prop("suspendcount", suspendcount => --suspendcount)
          // The classification time is rather vague, this doesn't necessarily has
          // to be the Resume() called by the classifier, it's just likely to be the one.
          .propIf("classify-time", (val, ch) => this.duration(ch.__classifystarttime), ch => ch.__classifystarttime)
          .capture();

        delete ch.__classifystarttime;
        netcap(n => { n.channelResume(ch) });
      });
      module.rule("nsHttpChannel::Cancel [this=%p status=%x]", function(ptr, status) {
        this.obj(ptr).prop("cancel-status", status).prop("late-cancel", this.obj(ptr).state() == "finished").state("cancelled").capture();
      });
      module.rule("nsHttpChannel::ContinueProcessResponse1 [this=%p, rv=%x]", function(ptr) {
        this.thread.httpchannel_for_auth = this.obj(ptr).capture();
      });
      module.rule("nsHttpChannel::ProcessResponse [this=%p httpStatus=%d]", function(ptr, status) {
        this.thread.httpchannel_for_auth = this.obj(ptr).prop("http-status", status, true).capture();
      });
      module.rule("sending progress notification [this=%p status=%x progress=%d/%d]", function(ch, status) {
        this.obj(ch).capture().capture("  " + status + " = " + schema.NET_STATUS.$(status));
      });
      module.rule("sending progress and status notification [this=%p status=%x progress=%u/%d]", function(ch, status) {
        this.obj(ch).capture().capture("  " + status + " = " + schema.NET_STATUS.$(status));
      });
      module.rule("nsHttpChannel %p tracking resource=%d, cos=%u", function(ch, tracker) {
        ch = this.obj(ch).prop("tracker", tracker === "1").capture();
        netcap(n => { n.channelRecognizedTracker(ch) });
      });
      module.rule("nsHttpChannel::WaitingForTailUnblock this=%p, rc=%p", function(ch, rc) {
        this.thread.tail_request = this.obj(ch).capture().follow("  blocked=%d", (ch, blocked) => {
          if (blocked === "1") {
            ch.prop("tail-blocked", true).capture().__blocktime = this.timestamp;
            netcap(n => { n.channelTailing(ch) });
          }
        });
      });
      module.rule("nsHttpChannel::OnTailUnblock this=%p rv=%x rc=%p", function(ch, rv, rc) {
        ch = this.obj(ch);
        let after = this.duration(ch.__blocktime);
        ch.prop("tail-blocked", false).prop("tail-block-time", after)
          .capture().capture("  after " + after + "ms");
        netcap(n => { n.channelUntailing(ch) });
      });
      module.rule("HttpBaseChannel::AddAsNonTailRequest this=%p, rc=%p, already added=%d", function(ch, rc, added) {
        this.thread.tail_request =
          this.obj(ch).prop("tail-blocking", true).capture();
      });
      module.rule("HttpBaseChannel::RemoveAsNonTailRequest this=%p, rc=%p, already added=%d", function(ch, rc, added) {
        this.thread.tail_request =
          this.objIf(ch).propIf("tail-blocking", false, () => added === "1").capture();
      });
      module.rule("HttpBaseChannel::EnsureRequestContextID this=%p id=%x", function(ch, rcid) {
        this.obj(ch).prop("rc-id", rcid).capture();
      });
      module.rule("nsHttpChannel::OnClassOfServiceUpdated this=%p, cos=%u", function(ch, cos) {
        ch = this.obj(ch).capture().capture("  cos = " + schema.COS.$(cos));
        netcap(n => { n.channelCOS(ch, parseInt(cos)) });
      });
      module.rule("nsHttpChannel::SetPriority %p p=%d", function(ch, prio) {
        ch = this.obj(ch).capture();
        netcap(n => { n.channelPrio(ch, parseInt(prio)) });
      });
      module.rule("nsHttpChannel::OnRedirectVerifyCallback [this=%p] " +
                  "result=%x stack=%zu mWaitingForRedirectCallback=%u\n", function(ch, result) {
        ch = this.obj(ch).capture();
        if (result == "0") {
          ch.state("redirected");
        }
      });
      logan.summaryProps("nsHttpChannel", ["status", "http-status", "url"]);

      /******************************************************************************
       * nsHttpChannelAuthProvider
       ******************************************************************************/

      schema.ruleIf("nsHttpChannelAuthProvider::ProcessAuthentication [this=%p channel=%p code=%u SSLConnectFailed=%d]",
        proc => proc.thread.httpchannel_for_auth, function(ptr, ch, code, sslcon, auth_ch)
      {
        delete this.thread.httpchannel_for_auth;
        let provider = this.obj(ptr).class("nsHttpChannelAuthProvider").grep().follow(1);
        provider._channel = auth_ch.alias(ch).capture().link(ptr);
      });
      module.rule("nsHttpChannelAuthProvider::PromptForIdentity [this=%p channel=%p]", function(ptr, ch) {
        this.obj(ptr).capture().on("_channel", ch => ch.prop("asked-credentials", true));
      });
      module.rule("nsHttpChannelAuthProvider::AddAuthorizationHeaders? [this=%p channel=%p]\n", function(ptr, ch) {
        this.obj(ptr).capture().follow(2);
      });

      /******************************************************************************
       * nsHttpTransaction
       ******************************************************************************/

      module.rule("Creating nsHttpTransaction @%p", function(trans) {
        this.thread.httptransaction = (trans = this.obj(trans).create("nsHttpTransaction").grep());
      });
      module.rule("nsHttpTransaction::Init [this=%p caps=%x]", function(trans) {
        this.obj(trans).capture().follow("  window-id = %x", function(trans, id) {
          trans.prop("tab-id", id);
        });
      });
      schema.ruleIf("http request [", proc => proc.thread.httptransaction, function(trans) {
        delete this.thread.httptransaction;
        trans.capture().follow((trans, line) => {
          trans.capture(line);
          return line !== "]";
        });
      });
      schema.ruleIf("nsHttpConnectionMgr::AtActiveConnectionLimit [ci=%* caps=%d,totalCount=%d, maxPersistConns=%d]",
        proc => proc.thread.httptransaction, function(ci, caps, total, max, trans) {
          trans.capture().mention(ci);
        });
      schema.ruleIf("AtActiveConnectionLimit result: %s", proc => proc.thread.httptransaction, function(atlimit, trans) {
        delete this.thread.httptransaction;
        trans.capture();
      });
      module.rule("  adding transaction to pending queue [trans=%p pending-count=%d]", function(trans, pc) {
        trans = this.obj(trans).state("pending").capture();
        this.thread.on("conn_info", conn_info => {
          conn_info.link(trans);
        });
      });
      module.rule("nsHttpTransaction::CheckForStickyAuthScheme this=%p", function(trans) {
        this.obj(trans).capture().follow("  %*$");
      });
      module.rule("nsHttpTransaction::HandleContentStart [this=%p]", function(trans) {
        this.thread.httptransaction = this.obj(trans);
      });
      schema.ruleIf("http response [", proc => proc.thread.httptransaction, function(trans) {
        delete this.thread.httptransaction;
        trans.capture().follow((trans, line) => {
          trans.capture(line);
          return line !== "]";
        });
      });
      module.rule("nsHttpTransaction %p SetRequestContext %p", function(trans, rc) {
        this.obj(rc).link(this.obj(trans).capture());
      });
      module.rule("   blocked by request context: [rc=%p trans=%p blockers=%d]", function(rc, trans) {
        this.obj(trans).state("blocked").capture();
      });
      module.rule("nsHttpTransaction adding blocking transaction %p from request context %p", function(trans, rc) {
        this.obj(trans).prop("blocking", true).capture();
        this.obj(rc).capture();
      });
      module.rule("nsHttpTransaction::Close [this=%p reason=%d]", function(trans, status) {
        trans = this.obj(trans).prop("status", status).state("closed").capture();
        netcap(n => { n.transactionDone(trans) });
        this.thread.closedhttptransaction = trans;
      });
      module.rule("nsHttpTransaction::WritePipeSegment %p written=%u", function(trans, count) {
        trans = this.obj(trans).capture();
        netcap(n => { n.transactionReceived(trans, parseInt(count)) });
      });
      module.rule("nsHttpTransaction::ReadRequestSegment %p read=%u", function(trans, count) {
        trans = this.obj(trans).capture();
        netcap(n => { n.transactionSended(trans, parseInt(count)) });
      });
      module.rule("nsHttpTransaction::ShouldStopReading entry pressure this=%p", function(trans) {
        trans = this.obj(trans).prop("throttling-under-pressure", true).capture();
        netcap(n => { n.transactionThrottlePressure(trans) });
      });
      module.rule("nsHttpTransaction::WriteSegments %p response throttled", function(trans) {
        trans = this.obj(trans).prop("throttled", true).prop("ever-throttled", true).capture();
        netcap(n => { n.transactionThrottled(trans) });
      });
      module.rule("nsHttpTransaction::ResumeReading %p", function(trans) {
        this.obj(trans).prop("throttled", false).capture();
        netcap(n => { n.transactionUnthrottled(trans) });
      });
      module.rule("nsHttpConnectionMgr::ShouldThrottle trans=%p", function(trans) {
        this.obj(trans).capture().follow("  %*$");
      });
      module.rule("Destroying nsHttpTransaction @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("nsHttpTransaction", ["url"]);

      /******************************************************************************
       * nsHttpConnection
       ******************************************************************************/

      module.rule("Creating nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).create("nsHttpConnection").grep();
      });
      module.rule("nsHttpConnection::Init this=%p sockettransport=%p", function(conn, sock) {
        conn = this.obj(conn).capture();
        // The socket link is added as part of the halfopen connection creation
      });
      module.rule("nsHttpConnection::StartSpdy [this=%p, mDid0RTTSpdy=%d]", function(conn) {
        this.thread.spdyconn = this.obj(conn).capture();
      });
      module.rule("nsHttpConnection::Activate [this=%p trans=%p caps=%x]", function(conn, trans, caps) {
        conn = this.obj(conn).capture();
        trans = this.obj(trans).state("active").capture().link(conn);
        trans.httpconnection = conn;
        this.thread.activatedhttptrans = trans;
        netcap(n => { n.transactionActive(trans) });
      });
      module.ruleIf("nsHttpConnection::AddTransaction for SPDY", proc => proc.thread.activatedhttptrans, function(trans) {
        this.thread.httpspdytransaction = trans.capture();
      });
      module.rule("nsHttpConnection::SetUrgentStartOnly [this=%p urgent=%d]", function(conn, urgent) {
        this.obj(conn).prop("urgent", urgent === "1").capture();
      });
      module.rule("nsHttpConnection::OnSocketWritable %p ReadSegments returned [rv=%d read=%d sock-cond=%x again=%d]", function(conn, rv, read, cond, again) {
        conn = this.obj(conn).class("nsHttpConnection").capture().grep();
        if (parseInt(read) > 0) {
          conn.state("sent");
        }
        this.thread.on("networksocket", st => {
          conn.mention(st);
          return st;
        });
      });
      module.rule("nsHttpConnection::OnSocketReadable [this=%p]", function(conn) {
        conn = this.obj(conn).class("nsHttpConnection").state("recv").capture().grep();
        this.thread.on("networksocket", st => {
          conn.mention(st);
          return st;
        });
      });
      module.rule("nsHttpConnection::CloseTransaction[this=%p trans=%p reason=%x]", function(conn, trans, rv) {
        this.obj(conn).state("done").capture();
      });
      module.rule("Entering Idle Monitoring Mode [this=%p]", function(conn) {
        this.obj(conn).state("idle").capture();
      });
      module.rule("nsHttpConnectionMgr::OnMsgReclaimConnection [ent=%p conn=%p]", function(ent, conn) {
        this.thread.httpconnection_reclame = this.obj(conn).capture();
        this.thread.httpconnection_reclame.closedtransaction = this.thread.closedhttptransaction;
      });
      module.rule("nsHttpConnection::MoveTransactionsToSpdy moves single transaction %p into SpdySession %p", function(tr, session) {
        this.thread.httpspdytransaction = this.obj(tr);
      });
      module.rule("nsHttpConnection::EnsureNPNComplete %p [%s] negotiated to '%s'", function(conn, entry, proto) {
        this.obj(conn).prop("npn", proto).capture();
        this.thread.spdyconnentrykey = entry; // we want the key
      });
      module.rule("Destroying nsHttpConnection @%p", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * Http2Session
       ******************************************************************************/

      module.rule("Http2Session::Http2Session %p serial=%x", function(session) {
        session = this.obj(session).create("Http2Session").grep();
        this.thread.on("spdyconn", conn => {
          session.link(conn);
        });
        this.thread.on("spdyconnentrykey", ent => {
          session.prop("key", ent).mention(ent);
        });
      });
      module.rule("Http2Session::~Http2Session %p mDownstreamState=%x", function(session) {
        this.obj(session).destroy();
      });
      module.rule("Http2Session::AddStream session=%p stream=%p serial=%u NextID=0x%X (tentative)",
        function(session, stream, serial, id) {
          stream = this.obj(stream).prop("id", id);
          session = this.obj(session).class("Http2Session").grep().link(stream);
        });
      module.rule("Http2Session::LogIO %p stream=%p id=%x [%*]", function(session, stream, id, what) {
        this.obj(session).class("Http2Session").capture();
      });
      module.rule("Http2Session::WriteSegments %p InternalState %u", function(session, state) {
        this.obj(session).capture().capture(` state = ${schema.H2SESSION_STATE.$(state)}`);
      });
      module.rule("Http2Session::ChangeDownstreamState() %p from %u to %u", function(session, s1, s2) {
        this.obj(session).capture().capture(` from = ${schema.H2SESSION_STATE.$(s1)}, to = ${schema.H2SESSION_STATE.$(s2)}`);
      });
      logan.summaryProps("Http2Session", ["key"]);

      /******************************************************************************
       * Http2Stream
       ******************************************************************************/

      module.rule("Http2Stream::Http2Stream %p", function(ptr) {
        let stream = this.obj(ptr).create("Http2Stream").grep();
        this.thread.on("httpspdytransaction", tr => {
          tr.link(stream);
          stream.prop("url", tr.props["url"]);
          stream.httptransaction = tr;
        });
        this.thread.h2stream = stream;
      });
      module.rule("Http2Stream::Http2Stream %p trans=%p atrans=%p", function(ptr, tr) {
        let stream = this.obj(ptr).create("Http2Stream").grep();
        this.obj(tr).link(stream).call(tr => {
          stream.prop("url", tr.props["url"]);
          stream.httptransaction = tr;
        });
        delete this.thread.httpspdytransaction;
        this.thread.h2stream = stream;
      });
      module.rule("Http2Stream::~Http2Stream %p", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("Http2Stream::ChangeState() %p from %d to %d", function(stream, oldst, newst) {
        let state = schema.H2STREAM_STATE.$(newst);
        this.obj(stream).prop("upstreamstate", state).capture().capture(`  ${newst}=${state}`);
      });
      module.rule("Http2Session::ReadSegments %p stream=%p stream send complete", function(sess, stream) {
        this.obj(stream).state("sent").capture();
      });
      module.rule("Http2Stream::ConvertResponseHeaders %p response code %d", function(stream, code) {
        this.obj(stream).state("headers").capture();
      });
      module.rule("Start Processing Data Frame. Session=%p Stream ID %X Stream Ptr %p Fin=%d Len=%d", function(sess, streamid, stream, fin, len) {
        this.obj(stream).state("data").capture();
      });
      module.rule("Http2Stream::WriteSegments %p Buffered %X %d\n", function(stream, id, count) {
        stream = this.obj(stream).capture();
        // This only buffers the data, but it's an actual read from the socket, hence we
        // want it to be marked.  The rule for "read from flow control buffer" just below
        // will negate this so that the report from the transaction will balance.
        if (stream.httptransaction) {
          netcap(n => { n.transactionReceived(stream.httptransaction, parseInt(count)) });
        }
      });
      module.rule("Http2Stream::OnWriteSegment read from flow control buffer %p %x %d\n", function(stream, id, count) {
        stream = this.obj(stream).capture();
        // This is buffered data read and has already been reported on the transaction in the just above rule,
        // hence, make it negative to be ignored, since the transaction will report it again
        if (stream.httptransaction) {
          netcap(n => { n.transactionReceived(stream.httptransaction, -parseInt(count)) });
        }
      });
      module.rule("Http2Stream::ParseHttpRequestHeaders %p avail=%d state=%x", function(stream, avail, state) {
        this.obj(stream).capture().follow("Pushed Stream Match located %p id=%x key=%*$", (stream, pushed) => {
          stream.prop("pushed", true).link(pushed);
        });
      });
      module.rule("Http2Session::CloseStream %p %p 0x%x %X", function(sess, stream, streamid, result) {
        this.obj(stream).state("closed").prop("status", result).capture();
      });
      logan.summaryProps("Http2Stream", ["status", "url"]);

      /******************************************************************************
       * Http2PushedStream
       ******************************************************************************/

      module.rule("Http2PushedStream ctor this=%p 0x%X\n", function(stream, id) {
        this.obj(stream).inherits(this.thread.h2stream, "Http2PushedStream").prop("pushed-id", id);
      });

      /******************************************************************************
       * nsHalfOpenSocket
       ******************************************************************************/

      module.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%*]", function(ho, trans, ent, key) {
        this.thread.halfopen = this.obj(ho).create("nsHalfOpenSocket").prop("key", key).mention(key).grep();
      });
      module.rule("nsHalfOpenSocket::SetupPrimaryStream [this=%p ent=%s rv=%x]", function(ho, ent, rv) {
        ho = this.obj(ho).capture();
        this.thread.on("networksocket", (sock) => {
          ho.link(sock).primarysocket = sock;
        });
      });
      module.rule("nsHalfOpenSocket::SetupBackupStream [this=%p ent=%s rv=%x]", function(ho, ent, rv) {
        ho = this.obj(ho).capture();
        this.thread.on("networksocket", (sock) => {
          ho.link(sock).backupsocket = sock;
        });
      });
      module.rule("nsHalfOpenSocket::OnOutputStreamReady [this=%p ent=%s %s]", function(ho, end, streamtype) {
        this.thread.halfopen = this.obj(ho).capture();
      });
      module.rule("nsHalfOpenSocket::StartFastOpen [this=%p]", function(ho) {
        this.thread.halfopen = this.obj(ho).capture();
      });
      schema.ruleIf("nsHalfOpenSocket::SetupConn Created new nshttpconnection %p", proc => proc.thread.halfopen, function(conn, ho) {
        delete this.thread.halfopen;
        this.thread.on("networksocket", st => {
          conn = this.obj(conn).link(st);
          conn.networksocket = st;
        });
        ho.link(conn).capture();
      });
      module.rule("Destroying nsHalfOpenSocket [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("nsHalfOpenSocket", ["key"]);

      /******************************************************************************
       * connection manager
       ******************************************************************************/

      module.rule("nsConnectionEntry::nsConnectionEntry this=%p key=%*", function(ptr, key) {
        this.obj(ptr).create("nsConnectionEntry").alias(key).grep().prop("key", key);
      });
      module.rule("nsConnectionEntry::~nsConnectionEntry this=%p", function(ptr, key) {
        this.obj(ptr).destroy();
      });
      module.rule("nsHttpConnectionMgr::OnMsgProcessPendingQ [ci=%*]", function(key) {
        if (key === "nullptr") {
          return;
        }
        let connEntry = this.obj(key).capture();
        this.thread.on("httpconnection_reclame", conn => {
          connEntry.capture(`Reclaiming connection: ${conn.props.pointer}`);
          conn.on("closedtransaction", trans => {
            connEntry.capture("Last transaction on the connection:").mention(trans);
          });
        });
      });
      module.rule("nsHttpConnectionMgr::ProcessPendingQForEntry [ci=%* ent=%p active=%d idle=%d urgent-start-queue=%d queued=%d]", function(ci, ent) {
        this.obj(ci).class("nsConnectionEntry").grep().capture().follow("  %p", (ci, trans) => {
          return ci.capture();
        }, (ci, line) => {
          ci.capture();
          return line !== "]";
        });
      });
      module.rule("nsHttpConnectionMgr::TryDispatchTransaction without conn " +
                  "[trans=%p halfOpen=%p conn=%p ci=%p ci=%* caps=%x tunnelprovider=%p " +
                  "onlyreused=%d active=%u idle=%u]", function(trans, half, conn, ci, ci_key) {
          this.thread.httptransaction = this.obj(trans).capture("Attempt to dispatch on " + ci_key).mention(ci_key);
          this.thread.conn_info = this.obj(ci_key).capture().expect("   %*$").mention(trans).mention(conn);
        });
      schema.ruleIf("Spdy Dispatch Transaction via Activate(). Transaction host = %s, Connection host = %s",
        proc => proc.thread.httptransaction, function(trhost, conhost, tr) {
          this.thread.httpspdytransaction = tr.capture();
        });
      module.rule("nsHttpConnectionMgr::TryDispatchTransactionOnIdleConn, ent=%p, trans=%p, urgent=%d", function(ent, trans, ur) {
        this.obj(trans).capture().follow("  %* [conn=%p]", (trans, message, conn) => {
          trans.capture().mention(conn);
        });
      });
      module.rule("nsHttpConnectionMgr::DispatchTransaction [ent-ci=%s %p trans=%p caps=%d conn=%p priority=%d]",
        function(ent, mngr, trans, caps) {
          this.obj(trans).capture();
        }
      );
      logan.summaryProps("nsConnectionEntry", "key");

      /******************************************************************************
       * nsHttpCompresssConv
       ******************************************************************************/

      module.rule("nsHttpCompresssConv %p ctor", function(ptr) {
        let conv = this.obj(ptr).create("nsHttpCompresssConv").grep();
        this.thread.on("httpchannel_applying_conv", ch => {
          ch.link(conv);
        });
      });
      module.rule("nsHttpCompresssConv %p dtor", function(ptr) {
        this.obj(ptr).destroy();
      });

    }); // nsHttp

    schema.module("nsSocketTransport", (module) => {

      /******************************************************************************
       * nsSocketTransport
       ******************************************************************************/

      module.rule("creating nsSocketTransport @%p", function(sock) {
        this.thread.networksocket = this.obj(sock).create("nsSocketTransport").grep();
        netcap(n => { n.newSocket(this.thread.networksocket) });
      });
      module.rule("nsSocketTransport::Init [this=%p host=%s:%hu origin=%s:%d proxy=%s:%hu]\n", function(sock, host, hp, origin, op, proxy, pp) {
        this.obj(sock).prop("host", host + ":" + hp).prop("origin", origin + ":" + op).capture();
      });
      module.rule("nsSocketTransport::BuildSocket [this=%p]\n", function(sock) {
        this.thread.networksocket = this.obj(sock).capture().follow("  [secinfo=%p callbacks=%p]\n", (sock) => {
          this.thread.on("sslsocket", ssl => {
            sock.link(ssl).sslsocket = ssl;
          });
        });
      });
      schema.ruleIf("  trying address: %s", proc => proc.thread.networksocket, function(address, sock) {
        sock.capture().prop("addresses", address, true);
        this.thread.networksocket = null;
      });
      module.rule("nsSocketTransport::InitiateSocket TCP Fast Open started [this=%p]", function(sock) {
        this.thread.networksocket = this.obj(sock).prop("attempt-TFO", true).capture()
          .follow("nsSocketTransport::InitiateSocket skipping speculative connection for host %*$", (sock) => { sock.capture() });
      });
      module.rule("nsSocketTransport::SetConnectionFlags %p flags=%u", function(sock, flags) {
        this.obj(sock).capture().capture(`  flags = ${schema.SOCK_CONN_FLAGS.$(flags)}`);
      });
      module.rule("nsSocketTransport::OnSocketReady [this=%p outFlags=%d]", function(ptr, flgs) {
        this.thread.networksocket = this.obj(ptr)
          .class("nsSocketTransport")
          .grep()
          .prop("last-poll-flags", flgs)
          .capture()
          .follow("ErrorAccordingToNSPR [in=%d out=%x]", (sock, nsprerr, mozerr) => {
            sock.capture().prop("sock-error", mozerr, true);
          });
        netcap(n => { n.socketReady(this.thread.networksocket) });
      });
      module.rule("nsSocketTransport::SendStatus [this=%p status=%x]", function(sock, st) {
        sock = this.obj(sock).class("nsSocketTransport").grep().capture()
          .capture(`  ${st} = ${schema.NET_STATUS.$(st)}`).prop("last-status", schema.NET_STATUS.$(st));
        netcap(n => { n.socketStatus(sock, schema.NET_STATUS.$(st)) });
      });
      module.rule("nsSocketTransport::RecoverFromError [this=%p state=%u cond=%x]", function(sock, state, error) {
        this.obj(sock).prop("recover-from-error", error, true).capture().follow("  %*$", sock => sock.capture(), () => false);
      });
      module.ruleIf("nsSocketOutputStream::OnSocketReady [this=%p cond=%d]", proc => proc.thread.networksocket, function(ptr, cond, sock) {
        this.obj(sock).alias(ptr).prop("output-cond", cond).capture();
      });
      module.ruleIf("nsSocketInputStream::OnSocketReady [this=%p cond=%d]", proc => proc.thread.networksocket, function(ptr, cond, sock) {
        this.obj(sock).alias(ptr).prop("input-cond", cond).capture();
      });
      module.rule("nsSocketOutputStream::Write [this=%p count=%u]\n", function(ptr, count) {
        this.thread.networksocket = this.obj(ptr).capture().follow("  PR_Write returned [n=%d]\n", (sock, written) => {
          sock.capture();
        }, sock => sock.capture());
      });
      module.rule("nsSocketInputStream::Read [this=%p count=%u]\n", function(ptr, count) {
        this.thread.networksocket = this.obj(ptr).capture().follow("  PR_Read returned [n=%d]\n", (sock, read) => {
          sock.capture();
        }, sock => sock.capture());
      });
      module.rule("destroying nsSocketTransport @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("nsSocketTransport", ["origin"]);

      /******************************************************************************
       * PollableEvent
       ******************************************************************************/

      module.rule("PollableEvent::Signal PR_Write %d", function(count) {
        count = parseInt(count);
        this.service("PollableEvent").propIf("unread-signals",
          signal => signal + count,
          () => count > 0
        ).capture();
      });
      module.rule("PollableEvent::%/Signal|Clear/r PR_Read %d", function(method, count) {
        count = parseInt(count);
        this.service("PollableEvent").propIf("unread-signals",
          signal => (count < 0 ? 0 : (signal - count)),
          pe => "unread-signals" in pe.props
        ).capture();
      });
      module.rule("PollableEvent::%*$", function() {
        this.service("PollableEvent").capture();
      });
      module.rule("Pollable event signalling failed/timed out", function() {
        this.service("PollableEvent").capture().prop("restart-count", c => ++c);
      });

    }); // nsSocketTransport

    schema.module("pipnss", (module) => {

      /******************************************************************************
       * nsSSLIOLayer / SSLSocket
       ******************************************************************************/

      module.rule("[%p] nsSSLIOLayerSetOptions: using TLS version range (%x,%x)", function(fd) {
        this.thread.sslsocket_tls_version = this.line;
      });
      module.rule("[%p] Socket set up\n", function(fd) {
        this.thread.sslsocket = this.obj(fd).create("SSLSocket").capture(this.thread.sslsocket_tls_version).grep();
        delete this.thread.sslsocket_tls_version;
      });
      module.rule("[%p] Shutting down socket\n", function(fd) {
        this.obj(fd).destroy();
      });
    }); // pipnss

    schema.module("nsHostResolver", (module) => {

      /******************************************************************************
       * nsHostResolver
       ******************************************************************************/

      module.rule("Resolving host [%s].\n", function(host) {
        this.service("nsHostResolver").capture();
      });
      module.rule("Resolving host [%s] - bypassing cache.\n", function(host) {
        this.service("nsHostResolver").capture();
      });
      module.rule("%*$", function(host) {
        this.service("nsHostResolver").capture();
      });
    }); // nsHostResolver

    schema.module("cache2", (module) => {

      /******************************************************************************
       * CacheEntry
       ******************************************************************************/

      module.rule("CacheEntry::CacheEntry [this=%p]", function(ptr) {
        this.thread.httpcacheentry = this.obj(ptr).create("CacheEntry").grep();
      });
      schema.ruleIf("  new entry %p for %*$", proc => proc.thread.httpcacheentry, function(ptr, key, entry) {
        delete this.thread.httpcacheentry;
        entry.prop("key", key);
      });
      module.rule("New CacheEntryHandle %p for entry %p", function(handle, entry) {
        this.obj(entry).class("CacheEntry").capture().grep().alias(handle);
        this.thread.on("cacheentryconsumer", c => {
          c.link(entry);
        });
      });
      module.rule("CacheEntry::Load [this=%p, trunc=%d]", function(entry) {
        this.thread.httpcacheentry = this.obj(entry).capture();
      });
      module.rule("CacheEntryHandle::~CacheEntryHandle %p", function(handle) {
        this.objIf(handle).capture().unalias();
      });
      module.rule("CacheEntry::~CacheEntry [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("CacheEntry", ["key"]);

      /******************************************************************************
       * CacheFile
       ******************************************************************************/

      module.rule("CacheFile::CacheFile() [this=%p]", function(ptr) {
        ptr = this.obj(ptr).create("CacheFile").grep();
        this.thread.on("httpcacheentry", entry => {
          entry.link(ptr);
        });
      });
      module.rule("CacheFile::Init() [this=%p, key=%s, createNew=%d, memoryOnly=%d, priority=%d, listener=%p]", function(file, key) {
        this.thread.cachefile = this.obj(file).capture().prop("key", key);
      });
      module.rule("CacheFile::OnFileOpened() [this=%p, rv=0x%08x, handle=%p]", function(file, status, handle) {
        this.thread.cachefile = this.obj(file).capture().link(handle);
      });
      function linkWithKey(file, sub) {
        file.link(this.obj(sub).prop("key", file.props["key"]));
      };
      module.rule("CacheFile::OpenOutputStream() - Creating new output stream %p [this=%p]", function(stream, file) {
        this.obj(file).capture().call(linkWithKey, stream);
      });
      module.rule("CacheFile::OpenAlternativeOutputStream() - Creating new output stream %p [this=%p]", function(stream, file) {
        this.obj(file).capture().call(linkWithKey, stream);
      });
      module.rule("CacheFile::OpenInputStream() - Creating new input stream %p [this=%p]", function(stream, file) {
        this.obj(file).capture().call(linkWithKey, stream);
      });
      module.rule("CacheFile::OpenAlternativeInputStream() - Creating new input stream %p [this=%p]", function(stream, file) {
        this.obj(file).capture().call(linkWithKey, stream);
      });
      module.rule("CacheFile::GetChunkLocked() - Reading newly created chunk %p from the disk [this=%p]", function(chunk, file) {
        this.obj(file).capture().call(linkWithKey, chunk);
      });
      module.rule("CacheFile::GetChunkLocked() - Created new empty chunk %p [this=%p]", function(chunk, file) {
        this.obj(file).capture().call(linkWithKey, chunk);
      });
      module.rule("CacheFile::~CacheFile() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("CacheFile", ["key"]);

      /******************************************************************************
       * CacheFileMetadata
       ******************************************************************************/

      function linkCacheFileMetadata(metadata) {
        this.thread.on("cachefile", (file) => {
          file.link(metadata.prop("key", file.props["key"]));
        });
      }
      module.rule("CacheFileMetadata::CacheFileMetadata() [this=%p, handle=%p, key=%s]", function(ptr) {
        this.obj(ptr).create("CacheFileMetadata").grep().call(linkCacheFileMetadata);
      });
      module.rule("CacheFileMetadata::CacheFileMetadata() [this=%p, key=%s]", function(ptr) {
        this.obj(ptr).create("CacheFileMetadata").grep().call(linkCacheFileMetadata);
      });
      module.rule("CacheFileMetadata::CacheFileMetadata() [this=%p]", function(ptr) {
        this.obj(ptr).create("CacheFileMetadata").grep().call(linkCacheFileMetadata);
      });
      module.rule("CacheFileMetadata::~CacheFileMetadata() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * CacheFileInputStream
       ******************************************************************************/

      module.rule("CacheFileInputStream::CacheFileInputStream() [this=%p]", function(ptr) {
        this.obj(ptr).create("CacheFileInputStream").grep();
      });
      module.rule("CacheFileInputStream::~CacheFileInputStream() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * CacheFileOutputStream
       ******************************************************************************/

      module.rule("CacheFileOutputStream::CacheFileOutputStream() [this=%p]", function(ptr) {
        this.obj(ptr).create("CacheFileOutputStream").grep();
      });
      module.rule("CacheFileOutputStream::~CacheFileOutputStream() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });

      /******************************************************************************
       * CacheFileHandle
       ******************************************************************************/

      module.rule("CacheFileHandle::CacheFileHandle() [this=%p, %/hash|key/r=%s]", function(ptr, prop, key) {
        this.obj(ptr).create("CacheFileHandle").grep().prop("key", key);
      });
      module.rule("CacheFileHandle::~CacheFileHandle() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("CacheFileHandle", ["key"]);

      /******************************************************************************
       * CacheFileChunk
       ******************************************************************************/

      module.rule("CacheFileChunk::CacheFileChunk() [this=%p, index=%u, initByWriter=%d]", function(ptr, index) {
        this.obj(ptr).create("CacheFileChunk").grep().prop("index", index)
      });
      module.rule("CacheFileChunk::~CacheFileChunk() [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      logan.summaryProps("CacheFileChunk", ["key", "index"]);

    }); // cache2

    schema.module("proxy", (module) => {

      /******************************************************************************
       * nsProtocolProxyService::AsyncApplyFilters
       ******************************************************************************/

      module.rule("AsyncApplyFilters %p", function(ptr) {
        this.obj(ptr).create("Proxy::AsyncApplyFilters").grep().__creation_time = this.timestamp;
      });
      module.rule("~AsyncApplyFilters %p", function(ptr) {
        this.obj(ptr).prop("lifetime", (val, applier) => this.duration(applier.__creation_time)).destroy();
      });
      module.rule("AsyncApplyFilters::ProcessNextFilter %p ENTER pi=%p", function(ptr) {
        this.obj(ptr).capture().follow("  %*$");
      });
      module.rule("AsyncApplyFilters::OnProxyFilterResult %p pi=%p", function(ptr) {
        this.obj(ptr).capture().follow("  %*$");
      });

      /******************************************************************************
       * nsProtocolProxyService::FilterLink
       ******************************************************************************/

      module.rule("nsProtocolProxyService::FilterLink::FilterLink %p, %/(?:channel\-)?/rfilter=%p", function(filter, kind, target) {
        this.obj(filter).create("Proxy::FilterLink").alias(target).grep().__creation_time = this.timestamp;
      });
      module.rule("nsProtocolProxyService::FilterLink::~FilterLink %p", function(filter) {
        this.obj(filter).prop("lifetime", (val, filter) => this.duration(filter.__creation_time)).destroy();
      });

      /******************************************************************************
       * nsProtocolProxyService
       ******************************************************************************/

      module.rule("nsProtocolProxyService::InsertFilterLink filter=%p", function(filter) {
        this.service("nsProtocolProxyService").capture();
      });
      module.rule("nsProtocolProxyService::RemoveFilterLink target=%p", function(filter) {
        this.service("nsProtocolProxyService").capture();
      });

    }); // proxy

  }
); // MOZ_LOG


logan.schema("debug text console",
  /*
   * This is the general text debug console output mixed with TEST-* lines
   */

  (line, proc) => {
    proc._ipc = true;

    return {
      text: line,
      forward: { "MOZ_LOG": line, },
    };
  },

  (schema) => {

    schema.module(0, (module) => {

      module.rule("TEST-START | %s", function(test) {
        if (test === "Shutdown") {
        } else {
          this.global.running_test = this.obj(test).create("test-run").grep();
        }
      });
      module.rule("TEST-%/OK|PASS|UNEXPECTED-FAIL/r | %s | took %dms", function(result, test, duration) {
        if (test === "Shutdown") {
        } else {
          this.obj(test).prop("result", result).prop("duration", duration).destroy();
          delete this.global.running_test;
        }
      });

      module.ruleIf("++DOMWINDOW == %u (%p) [pid = %d] [serial = %d] [outer = %p]", proc => proc.global.running_test, function(count, win, pid, serial, outer, test) {
        win = this.obj(win).create("DOMWINDOW").prop("serial", serial).prop("pid", pid);
        win.__pid = pid;
        win.__test = test;
      });
      module.rule("--DOMWINDOW == %u (%p) [pid = %d] [serial = %d] [outer = %p] [url = %s]", function(count, win, pid, serial, outer, url) {
        win = this.objIf(win).prop("url", url);

        if (win.__test && this.global.data("pids", pid).after_leak_collection) {
          win.prop("leaked", true);
          win.capture(`leaked at ${win.__test.props.pointer}`).mention(win.__test);
        }

        win.destroy();
      });
      logan.summaryProps("DOMWINDOW", ["url", "pid"]);

      module.rule("Completed ShutdownLeaks collections in process %u", function(pid) {
        this.global.data("pids", pid).after_leak_collection = true;
        this.service("shutdown").capture();
      });

    }); // 0 module
  }
); // text console


logan.schema("./mach test",
  /*
   * This is for running |./mach test| locally and piping the output to a file
   */

  (line, proc) => {
    let match;

    proc._ipc = true;

    /* GECKO(7912) | some console text */ // this is mochitest-browser
    match = line.match(/^(\w+)\((\d+)\) \| (.*)$/);
    if (match) {
      let [all, process_name, pid, text] = match;
      return {
        text: text,
        forward: { "debug text console": text },
      };
    }

    /* PID 12584 | 2018-02-08 17:30:20.052000 UTC - [12584:Main Thread]: D/nsHostResolver nsHostResolver::Init this=0000021C55746300 */ // this is xpcshell
    match = line.match(/^PID (\d+) \| (.*)$/);
    if (match) {
      let [all, pid, text] = match;
      return {
        text: text,
        forward: { "debug text console": text },
      };
    }

    /* 0:01.67 pid:8768 [8768:Main Thread]: D/nsSocketTransport PollableEvent::Signal */ // comm-central xpcshell-test
    match = line.match(/^\s*\d+:\d+\.\d+ pid:(\d+) (.*)$/);
    if (match) {
      let [all, pid, text] = match;
      return {
        text: text,
        forward: { "debug text console": text },
      };
    }

    return {
      text: line,
      forward: { "debug text console": line },
    };
  },

  (schema) => {

  }
); // ./mach test


logan.schema("treeherder log",
  /*
   * This is for logs downloaded from treeherder
   */

  (line, proc) => {
    let match;

    proc._ipc = true;

    /* [task 2018-02-08T11:29:03.142Z] 11:29:03     INFO - Stopping web server */
    match = line.match(/^\[(\w+) (\d+\-\d\d\-\d\dT\d\d:\d\d:\d\d\.\d+Z)\] (\d+:\d\d:\d\d)\s+([A-Z]+) - (.*)$/);
    if (match) {
      let [all, origin, timestamp, time, level, text] = match;
      return {
        text: text,
        timestamp: new Date(timestamp),
        forward: { "./mach test": text, },
      };
    }

    /* 22:54:10     INFO -  17 INFO TEST-START | browser/components/originattributes/test/browser/browser_cache.js */
    match = line.match(/^(\d+:\d\d:\d\d)\s+([A-Z]+) -\s+((?:None)?\d+) ([A-Z]+) (.*)$/);
    if (match) {
      let [all, time, level, sub_order, sub_level, text] = match;
      return {
        text: text,
        module: "test",
        forward: { "debug text console": text, },
      };
    }

    /* 22:54:10     INFO -  some console text */
    match = line.match(/^(\d+:\d\d:\d\d)\s+([A-Z]+) -\s+(.*)$/);
    if (match) {
      let [all, time, level, text] = match;
      return {
        text: text,
        forward: { "./mach test": text, },
      };
    }

    /* 03-12 20:16:23.488  4670  4670 I Gecko   : [4670:Main Thread]: D/nsHttp nsHttpHandler::NewProxiedChannel [proxyInfo=0] */
    match = line.match(/^\d+\-\d+ \d+:\d+:\d+\.\d+  (\d+)  (\d+) ([A-Z]) (\w+)   : (.*)$/);
    if (match) {
      let [all, pid, pid2, level, process_name, text] = match;
      return {
        text: text,
        forward: { "debug text console": text },
      };
    }

    return undefined;
  },

  (schema) => {

  }
); // treeherder log


logan.schema("rr console",
  /*
   * This is for piped console output when running rr
   */

  (line, proc) => {
    let match;

    proc._ipc = true;

    match = line.match(/^\[rr (\d+) (\d+)\](.*)$/);
    if (match) {

      let [all, pid, rrline, text] = match;
      return {
        text: text,
        forward: { "debug text console": text, }
      };
    }

    return undefined;
  },

  (schema) => {

  }
); // rr console


logan.defaultSchema("MOZ_LOG");
