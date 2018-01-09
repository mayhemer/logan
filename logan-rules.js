logan.schema("moz", (line, proc) =>
  {
    let match;

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

    match = line.match(/^\[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/);
    if (match) {
      let [all, thread, level, module, text] = match;
      return {
        text: text,
        threadname: thread,
        module: module,
      };
    }

    match = line.match(/^\[rr (\d+) (\d+)\]\[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/);
    if (match) {
      // this is likely a mixed console log that may have both parent and child logs in it, force ipc usage
      proc._ipc = true;

      let [all, pid, rrline, thread, level, module, text] = match;
      return {
        text: text,
        threadname: `${thread}[${pid}]`,
        module: module,
      };
    }

    return undefined; // just express it explicitly
  },

  (schema) => {
    schema.ClassOfServiceFlags = {
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

      stringify: function(cos) {
        let result = "";
        for (let flag in this) {
          if (typeof this[flag] !== "number") {
            continue;
          }
          if (cos & this[flag]) {
            if (result) result += ", ";
            result += flag;
          }
        }
        return result || "0";
      }
    };

    convertProgressStatus = (status) => {
      switch (parseInt(status, 16)) {
        case 0x804B0008: return "STATUS_READING";
        case 0x804B0009: return "STATUS_WRITING";
        case 0x804b0003: return "STATUS_RESOLVING";
        case 0x804b000b: return "STATUS_RESOLVED";
        case 0x804b0007: return "STATUS_CONNECTING_TO";
        case 0x804b0004: return "STATUS_CONNECTED_TO";
        case 0x804B000C: return "STATUS_TLS_HANDSHAKE_STARTING";
        case 0x804B000D: return "STATUS_TLS_HANDSHAKE_ENDED";
        case 0x804b0005: return "STATUS_SENDING_TO";
        case 0x804b000a: return "STATUS_WAITING_FOR";
        case 0x804b0006: return "STATUS_RECEIVING_FROM";
        default: return status;
      }
    }

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
        ps = this.obj(ps);
        ps.prop("first-paint-time-ms", this.duration(ps.__init_time)).capture();
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
      schema.summaryProps("nsDocShell", ["url"]);

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
        this.obj(rc).capture().mention(req).follow(1);
      });
      module.rule("RequestContext::CancelTailedRequest %p req=%p removed=%d", function(rc, req) {
        this.obj(rc).capture().mention(req);
      });
      module.rule("RequestContext::RemoveNonTailRequest this=%p, cnt=%d", function(rc, cnt) {
        rc = this.obj(rc).capture();
        this.thread.on("tail_request", (ch) => (rc.mention(ch), ch));
      });
      module.rule("RequestContext::AddNonTailRequest this=%p, cnt=%d", function(rc, cnt) {
        rc = this.obj(rc).capture();
        this.thread.on("tail_request", (ch) => (rc.mention(ch), ch));
      });
      schema.summaryProps("RequestContext", []);

    }); // RequestContext

    schema.module("LoadGroup", (module) => {

      /******************************************************************************
       * nsLoadGroup
       ******************************************************************************/

      module.rule("LOADGROUP [%p]: Created.\n", function(ptr) {
        this.thread.loadgroup = this.obj(ptr).create("nsLoadGroup").prop("requests", 0).prop("foreground-requests", 0).grep();
      });
      module.rule("LOADGROUP [%p]: Destroyed.\n", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("LOADGROUP [%p]: Adding request %p %s (count=%d).\n", function(lg, req, name, count) {
        this.thread.on("httpchannelchild", ch => { ch.alias(req); });
        this.thread.on("wyciwigchild", ch => { ch.alias(req); });
        this.thread.on("imagerequestproxy", ch => { ch.alias(req); });
        this.thread.on("imagerequest", ch => { ch.alias(req); });

        this.obj(lg).prop("requests", count => ++count).prop("foreground-requests", parseInt(count) + 1).capture().link(req);
        this.obj(req).class("unknown request").prop("in-load-group", lg, true);
      });
      module.rule("LOADGROUP [%p]: Removing request %p %s status %x (count=%d).\n", function(lg, req, name, status, count) {
        this.obj(lg).prop("requests", count => --count).prop("foreground-requests", count).capture().mention(req);
        this.obj(req).prop("in-load-group");
      });
      module.rule("LOADGROUP [%p]: Unable to remove request %p. Not in group!\n", function(lg, req) {
        this.obj(lg).prop("requests", count => ++count).capture();
        this.obj(req).prop("not-found-in-loadgroup", true);
      });
      module.rule("nsLoadGroup::SetDefaultLoadRequest this=%p default-request=%p", function(lg, req) {
        // TODO - alias the request?
        this.obj(lg).capture().link(this.obj(req).class("unknown default request"));
      });
      module.rule("nsLoadGroup::OnEndPageLoad this=%p default-request=%p", function(lg, dch) {
        lg = this.obj(lg).capture().mention(dch);
        netcap(n => { n.EndPageLoad(lg) });
      });
      schema.summaryProps("nsLoadGroup", ["requests", "foreground-requests"]);

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
        let request = this.obj(ptr);
        request.capture().propIfNull("open-to-first-data", this.duration(request.__opentime));
      });
      module.rule("%d [this=%p] imgRequest::OnStopRequest", function(now, ptr) {
        let request = this.obj(ptr);
        request.capture().prop("open-to-stop", this.duration(request.__opentime));
      });
      module.rule("%d [this=%p] imgRequest::~imgRequest() (keyuri=\"%s\")", function(now, ptr, key) {
        this.obj(ptr).destroy();
      });
      module.rule("%d [this=%p] imgRequest::~imgRequest()", function(now, ptr) {
        this.obj(ptr).destroy();
      });
      schema.summaryProps("imgRequest", ["url"]);

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
      schema.summaryProps("ScriptLoadRequest", ["url"]);

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

    });

    schema.module("nsHttp", (module) => {

      /******************************************************************************
       * HttpChannelChild
       ******************************************************************************/

      module.rule("Creating HttpChannelChild @%p", function(ptr) {
        this.thread.httpchannelchild = this.obj(ptr).create("HttpChannelChild").grep();
      });
      module.rule("Destroying HttpChannelChild @%p", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("HttpChannelChild::AsyncOpen [this=%p uri=%s]", function(ptr, uri) {
        this.thread.httpchannelchild = this.obj(ptr).prop("url", uri).state("open").capture();
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
      module.rule("HttpChannelChild::OnStopRequest [this=%p]", function(ptr) {
        this.obj(ptr).recv("HttpChannel::Stop", ch => {
          ch.state("finished").capture();
        });
      });
      module.rule("HttpChannelChild::DoOnStopRequest [this=%p]", function(ptr) {
        this.obj(ptr).recv("HttpChannel::Stop", ch => {
          ch.state("finished").capture();
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
      schema.summaryProps("HttpChannelChild", ["url", "status"]);

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
        this.obj(ch).ipcid(id).capture().recv("HttpChannel::ConnectParent", (parent, child) => {
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
       * nsHttpChannel
       ******************************************************************************/

      module.rule("Creating nsHttpChannel [this=%p]", function(ch) {
        ch = this.obj(ch).create("nsHttpChannel").grep().expect("uri=%s", (ch, uri) => {
          ch.prop("url", uri);
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
      schema.ruleIf("nsHttpChannel::SetupReplacementChannel [this=%p newChannel=%p preserveMethod=%d]",
        proc => proc.thread.httpchannel_init,
        function(oldch, newch, presmethod, channel) {
          delete this.thread.httpchannel_init;
          channel.alias(newch);
          this.obj(oldch).capture().link(newch);
        });
      module.rule("nsHttpChannel::AsyncOpen [this=%p]", function(ptr) {
        let channel = this.obj(ptr).state("open").capture();
        channel.__opentime = this.timestamp;
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
        this.obj(ch).capture().link(this.obj(cl).class("nsChannelClassifier"));
      });
      module.rule("nsHttpChannel::ReadFromCache [this=%p] Using cached copy of: %s", function(ptr) {
        this.obj(ptr).prop("from-cache", true).capture();
      });
      module.rule("nsHttpChannel::OnStartRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        ch = this.obj(ch).class("nsHttpChannel");
        ch.run("start")
          .prop("start-time", this.duration(ch.__opentime))
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
        ch = this.obj(ch).class("nsHttpChannel");
        ch.run("data")
          .propIfNull("first-data-time", this.duration(ch.__opentime))
          .prop("last-data-time", this.duration(ch.__opentime))
          .state("data")
          .capture()
          .send("HttpChannel::Data");
      });
      module.rule("nsHttpChannel::OnStopRequest [this=%p request=%p status=%x]", function(ch, pump, status) {
        ch = this.obj(ch).class("nsHttpChannel");
        ch.run("stop")
          .prop("status", status, true)
          .prop("stop-time", this.duration(ch.__opentime))
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
        ch = this.obj(ch).run("resume").prop("suspendcount", suspendcount => --suspendcount).capture();
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
        this.obj(ch).capture().capture("  " + status + " = " + convertProgressStatus(status));
      });
      module.rule("sending progress and status notification [this=%p status=%x progress=%u/%d]", function(ch, status) {
        this.obj(ch).capture().capture("  " + status + " = " + convertProgressStatus(status));
      });
      module.rule("HttpBaseChannel::SetIsTrackingResource %p", function(ch) {
        ch = this.obj(ch).prop("tracker", true).capture();
        netcap(n => { n.channelRecognizedTracker(ch) });
      });
      module.rule("nsHttpChannel %p on-local-blacklist=%d", function(ch, lcb) {
        this.obj(ch).prop("local-block-list", lcb === "1").capture();
      });
      module.rule("nsHttpChannel::WaitingForTailUnblock this=%p, rc=%p", function(ch, rc) {
        this.thread.tail_request = this.obj(ch).capture().mention(rc).follow("  blocked=%d", (ch, blocked) => {
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
          .capture().capture("  after " + after + "ms").mention(rc);
        netcap(n => { n.channelUntailing(ch) });
      });
      module.rule("HttpBaseChannel::AddAsNonTailRequest this=%p, rc=%p, already added=%d", function(ch, rc, added) {
        this.thread.tail_request =
          this.obj(ch).prop("tail-blocking", true).capture().mention(rc);
      });
      module.rule("HttpBaseChannel::RemoveAsNonTailRequest this=%p, rc=%p, already added=%d", function(ch, rc, added) {
        this.thread.tail_request =
          this.objIf(ch).propIf("tail-blocking", false, () => added === "1").capture().mention(rc);
      });
      module.rule("HttpBaseChannel::EnsureRequestContextID this=%p id=%x", function(ch, rcid) {
        this.obj(ch).prop("rc-id", rcid).capture();
      });
      module.rule("HttpBaseChannel::EnsureRequestContext this=%p rc=%p", function(ch, rc) {
        this.obj(ch).capture().mention(rc);
      });
      module.rule("nsHttpChannel::OnClassOfServiceUpdated this=%p, cos=%u", function(ch, cos) {
        ch = this.obj(ch).capture().capture("  cos = " + schema.ClassOfServiceFlags.stringify(cos));
        netcap(n => { n.channelCOS(ch, parseInt(cos)) });
      });
      module.rule("nsHttpChannel::SetPriority %p p=%d", function(ch, prio) {
        ch = this.obj(ch).capture();
        netcap(n => { n.channelPrio(ch, parseInt(prio)) });
      });
      schema.summaryProps("nsHttpChannel", ["http-status", "url", "status"]);

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
      schema.ruleIf("nsHttpConnectionMgr::AtActiveConnectionLimit [ci=%s caps=%d,totalCount=%d, maxPersistConns=%d]",
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
        trans = this.obj(trans);
        trans.dispatch(trans.httpchannel, "start");
        this.thread.httptransaction = trans;
      });
      schema.ruleIf("http response [", proc => proc.thread.httptransaction, function(trans) {
        delete this.thread.httptransaction;
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
        this.obj(trans).prop("blocking", true).capture();
        this.obj(rc).capture().mention(trans);
      });
      module.rule("nsHttpTransaction removing blocking transaction %p from request context %p. %d blockers remain.", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpTransaction %p request context set to null in ReleaseBlockingTransaction() - was %p", function(trans, rc) {
        this.obj(trans).capture().mention(rc);
      });
      module.rule("nsHttpTransaction::Close [this=%p reason=%d]", function(trans, status) {
        trans = this.obj(trans).prop("status", status).state("closed").capture();
        trans.dispatch(trans.httpchannel, "stop");
        netcap(n => { n.transactionDone(trans) });
        this.thread.closedhttptransaction = trans;
      });
      module.rule("nsHttpTransaction::WritePipeSegment %p written=%u", function(trans, count) {
        trans = this.obj(trans).capture().dispatch(trans.httpchannel, "data");
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
      schema.summaryProps("nsHttpTransaction", ["blocking", "tab-id", "url"]);

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
        netcap(n => { n.transactionActive(trans) });
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
        this.obj(conn).state("done").capture().mention(trans);
      });
      module.rule("Entering Idle Monitoring Mode [this=%p]", function(conn) {
        this.obj(conn).state("idle").capture();
      });
      module.rule("nsHttpConnectionMgr::OnMsgReclaimConnection [ent=%p conn=%p]", function(ent, conn) {
        this.thread.httpconnection_reclame = this.obj(conn).capture().mention(ent);
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
        this.obj(session).class("Http2Session").capture().mention(stream);
      });
      schema.summaryProps("Http2Session", ["key"]);

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
      });
      module.rule("Http2Stream::~Http2Stream %p", function(ptr) {
        this.obj(ptr).destroy();
      });
      module.rule("Http2Stream::ChangeState() %p from %d to %d", function(stream, oldst, newst) {
        switch (parseInt(newst)) {
          case 0: newst = "GENERATING_HEADERS"; break;
          case 1: newst = "GENERATING_BODY"; break;
          case 2: newst = "SENDING_BODY"; break;
          case 3: newst = "SENDING_FIN_STREAM"; break;
          case 4: newst = "UPSTREAM_COMPLETE"; break;
        }
        this.obj(stream).prop("upstreamstate", newst).capture();
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
      module.rule("Http2Session::CloseStream %p %p 0x%x %X", function(sess, stream, streamid, result) {
        this.obj(stream).state("closed").prop("status", result).capture();
      });
      schema.summaryProps("Http2Stream", ["status", "url"]);

      /******************************************************************************
       * nsHalfOpenSocket
       ******************************************************************************/

      module.rule("Creating nsHalfOpenSocket [this=%p trans=%p ent=%s key=%s]", function(ho, trans, ent, key) {
        this.thread.halfopen = this.obj(ho).create("nsHalfOpenSocket").prop("key", key).grep();
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
      schema.summaryProps("nsHalfOpenSocket", ["key"]);

      /******************************************************************************
       * connection manager
       ******************************************************************************/

      module.rule("nsConnectionEntry::nsConnectionEntry this=%p key=%s", function(ptr, key) {
        this.obj(ptr).create("nsConnectionEntry").alias(key).grep().prop("key", key);
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
          conn.on("closedtransaction", trans => {
            connEntry.capture("Last transaction on the connection:").mention(trans);
          });
        });
      });
      module.rule("nsHttpConnectionMgr::ProcessPendingQForEntry [ci=%s ent=%p active=%d idle=%d urgent-start-queue=%d queued=%d]", function(ci, ent) {
        this.obj(ci).class("nsConnectionEntry").grep().capture().follow("  %p", (ci, trans) => {
          return ci.mention(trans);
        }, (ci, line) => {
          ci.capture();
          return line !== "]";
        });
      });
      module.rule("nsHttpConnectionMgr::TryDispatchTransaction without conn " +
                  "[trans=%p halfOpen=%p conn=%p ci=%p ci=%s caps=%x tunnelprovider=%p " +
                  "onlyreused=%d active=%u idle=%u]", function(trans, half, conn, ci, ci_key) {
          this.thread.httptransaction = this.obj(trans).capture("Attempt to dispatch on " + ci_key).mention(ci_key);
          this.thread.conn_info = this.obj(ci_key).capture().expect("   %*$").mention(trans).mention(conn);
        });
      schema.ruleIf("Spdy Dispatch Transaction via Activate(). Transaction host = %s, Connection host = %s",
        proc => proc.thread.httptransaction, function(trhost, conhost, tr) {
          this.thread.httpspdytransaction = tr;
        });
      module.rule("nsHttpConnectionMgr::TryDispatchTransactionOnIdleConn, ent=%p, trans=%p, urgent=%d", function(ent, trans, ur) {
        this.obj(trans).capture().follow("  %* [conn=%p]", (trans, message, conn) => {
          trans.capture().mention(conn);
        });
      });
      schema.summaryProps("nsConnectionEntry", "key");

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
        sock.capture();
        this.thread.networksocket = null;
      });
      module.rule("nsSocketTransport::InitiateSocket TCP Fast Open started [this=%p]", function(sock) {
        this.thread.networksocket = this.obj(sock).prop("attempt-TFO", true).capture()
          .follow("nsSocketTransport::InitiateSocket skipping speculative connection for host %*$", (sock) => { sock.capture() });
      });
      module.rule("nsSocketTransport::OnSocketReady [this=%p outFlags=%d]", function(ptr, flgs) {
        this.thread.networksocket = this.obj(ptr).class("nsSocketTransport").grep().prop("last-poll-flags", flgs).capture();
        netcap(n => { n.socketReady(this.thread.networksocket) });
      });
      module.rule("nsSocketTransport::SendStatus [this=%p status=%x]", function(sock, st) {
        sock = this.obj(sock).class("nsSocketTransport").grep().capture()
          .capture(`  ${st} = ${convertProgressStatus(st)}`).prop("last-status", convertProgressStatus(st));
        netcap(n => { n.socketStatus(sock, convertProgressStatus(st)) });
      });
      module.rule("nsSocketOutputStream::OnSocketReady [this=%p cond=%d]", function(ptr, cond) {
        this.thread.on("networksocket", st => st.alias(ptr).prop("output-cond", cond).capture());
      });
      module.rule("nsSocketInputStream::OnSocketReady [this=%p cond=%d]", function(ptr, cond) {
        this.thread.on("networksocket", st => st.alias(ptr).prop("input-cond", cond).capture());
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
      schema.summaryProps("nsSocketTransport", ["origin"]);

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

      module.resolver = (proc) => proc.obj("nsHostResolver::singleton").class("nsHostResolver");
      module.rule("Resolving host [%s].\n", function(host) {
        module.resolver(this).capture();
      });
      module.rule("Resolving host [%s] - bypassing cache.\n", function(host) {
        module.resolver(this).capture();
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
      module.rule("CacheEntry::~CacheEntry [this=%p]", function(ptr) {
        this.obj(ptr).destroy();
      });
      schema.summaryProps("CacheEntry", "key");

    }); // cache2

  }
); // moz
