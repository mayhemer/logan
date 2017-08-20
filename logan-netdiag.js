var netdiag = null;
var netdiagUI = null;

(function() {

  now = () => logan._proc.timestamp;
  duration = since => now().getTime() - since.getTime();
  interval = (a, b) => a && b ? (a.getTime() - b.getTime()) : undefined
  interval_t = (a, b) => interval(a, b) + " ms";
  assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failure"); }

  const ClassOfServiceFlags = {
    Leader: 1 << 0,
    Follower: 1 << 1,
    Speculative: 1 << 2,
    Background: 1 << 3,
    Unblocked: 1 << 4,
    Throttleable: 1 << 5,
    UrgentStart: 1 << 6,
    DontThrottle: 1 << 7,
    Tail: 1 << 8,

    isLeaderOrUrgent: function(cos) {
      if (cos === undefined) {
        return false;
      }
      return cos & (this.Leader | this.UrgentStart);
    },
    isLeader: function(cos) {
      if (cos === undefined) {
        return false;
      }
      return cos & (this.Leader);
    },
    isTailable: function(cos) {
      if (cos === undefined) {
        return false;
      }
      return (cos & this.Tail) && !(cos & (this.UrgentStart | this.Leader | this.Unblocked));      
    }
  };

  cosString = (cos) => {
    let result = "";
    for (let flag in ClassOfServiceFlags) {
      if (cos & ClassOfServiceFlags[flag]) {
        if (result) result += ", ";
        result += flag;
      }
    }
    return result || "0";
  }

  netdiag = {
    enabled: true,

    reset: function() {
      this.channels = [];
      this.toploads = [];
      this.captures = [];
    },

    capture: function(obj, what) {
      if (!this.enabled || !obj) { // e.g. trans.httpchannel on a null transaction
        return {};
      }

      let capture = {};
      obj.capture({ net: what }, capture);
      this.captures.push(capture);
      return capture;
    },

    /*
      // Rules make the following direct object links:
      (PressShell | nsDocument).docshell.loadgroup."rc-id"
      (nsHttpTransaction).httpconnection.networksocket
      (nsHttpTransaction).httpchannel."rc-id"
    */

    topload: function(docshell, url) {
      let cap = this.capture(docshell, { load: url });
      this.toploads.push({ capture: cap, rcid: docshell.loadgroup.props["rc-id"] });
    },
    DOMContentLoaded: function(docshell) {
      if (docshell) {
        this.capture(docshell, { DOMContentLoaded: true });
      }
    },
    FirstPaint: function(docshell) {
      if (docshell) {
        this.capture(docshell, { FirstPaint: true });
      }
    },
    EndPageLoad: function(lg) {
      let topload = Array.from(this.toploads).reverse().find(load => load.rcid == lg.props["rc-id"]);
      if (topload) {
        topload.EndPageLoad_capture = this.capture(lg, { EndPageLoad: true });
      }
    },

    channelAsyncOpen: function(channel) {
      this.channels.push(channel);
      this.capture(channel, { ch_open: true });
    },
    channelCreatesTrans: function(channel, trans) {
      this.capture(channel, { ch_trans: trans });
    },
    channelRecognizedTracker: function(channel) {
      this.capture(channel, { ch_tracker_recon: true });
    },
    channelSuspend: function(channel) {
      this.capture(channel, { ch_suspend: true });
    },
    channelResume: function(channel) {
      this.capture(channel, { ch_resume: true });
    },
    channelCOS: function(channel, cos) {
      this.capture(channel, { ch_cos: cos });
    },
    channelPrio: function(channel, prio) {
      this.capture(channel, { ch_prio: prio });
    },
    channelDone: function(channel) {
      this.capture(channel, { ch_stop: true });
    },
    channelTailing: function(channel) {
      this.capture(channel, { ch_tailed: true });
    },
    channelUntailing: function(channel) {
      this.capture(channel, { ch_tailed: false });
    },

    transactionActive: function(trans) {
      this.capture(trans.httpchannel, { trans_active: trans });
    },
    transactionThrottled: function(trans) {
      this.capture(trans.httpchannel, { trans_throttle: trans });
    },
    transactionUnthrottled: function(trans) {
      this.capture(trans.httpchannel, { trans_unthrottle: trans });
    },
    transactionThrottlePressure: function(trans) {
      this.capture(trans.httpchannel, { trans_throttle_pressure: trans });
    },
    transactionReceived: function(trans, amount) {
      this.capture(trans.httpchannel, { trans_recv: trans, amount: amount });
    },
    transactionSended: function(trans, amount) {
      this.capture(trans.httpchannel, { trans_send: trans, amount: amount });
    },
    transactionDone: function(trans) {
      this.capture(trans.httpchannel, { trans_done: trans });
    },

    newSocket: function(sock) {
      this.capture(sock, { socket_open: sock });
    },
    socketStatus: function(sock, status) {
      this.capture(sock, { socket_status: status });
    },
    socketReady: function(sock) {
      this.capture(sock, { ready_at: now() });
    },
  };

  netdiagUI = {
    channel_history: [],

    reset: function() {
      this.channel_history = [];
    },

    diagnose: function(UI, channel) {
      if (channel.props.className != "nsHttpChannel") {
        alert("Works only for nsHttpChannels");
        return;
      }

      let rcid = channel.props["rc-id"];
      console.log("netdiag for rc-id = " + rcid);

      let topload = Array.from(netdiag.toploads).reverse().find((load) =>
        load.capture.capture.id < channel.captures[0].id && load.rcid == rcid
      );
      if (!topload) {
        alert("No top-level document load for the selected channel's request-context id found :(  Have you loaded child process logs too?");
        return;
      }
      if (!topload.EndPageLoad_capture) {
        alert("The top-level document load for the selected channel's request-context id doesn't have the EndPageLoad marker :(  Did you wait for the page to finish?");
        return;
      }

      $("#netdiag_section").empty().append($("<input type='button'>")
        .val("\uD83E\uDC70")
        .addClass("button icon close")
        .click(() => {
          this.channel_history.pop();
          let previous = this.channel_history.pop();
          if (previous) {
            this.diagnose(UI, previous);
          } else {
            UI.setResultsView();
          }
        })
      );
      UI.setDiagnoseView();
      $("#netdiag_section").append(this.element = $("<div>").attr("data-collapse", "accordion"));

      let beginid = topload.capture.capture.id;
      let endid = topload.EndPageLoad_capture.capture.id;
      this.begintime = topload.capture.capture.time;
      this.endtime = topload.EndPageLoad_capture.capture.time;
      this.DOMContentLoaded_time = this.endtime;
      this.FirstPaint_time = this.endtime;

      this.channel_history.push(channel);

      let captures = netdiag.captures.filter(capture => capture.capture.id >= beginid && capture.capture.id <= endid);
      let results = {
        set: function(obj, what = {}) {
          let target = ensure(this, obj.id, () => ({ obj }));
          for (let prop in what) {
            target[prop] = what[prop];
          }
          return target;
        },
        allbut: function(obj, func) {
          for (let val of Object.values(this)) {
            if (val !== obj) {
              func(val);
            }
          }
        },
      };

      const STATE = {
        BEFORE_OPEN: 0,
        AFTER_OPEN: 1,
        AFTER_ACTIVATE: 2,
        AFTER_SEND: 3,
        AFTER_RECV: 4,
        AFTER_STOP: 5,
      };

      let state = STATE.BEFORE_OPEN;

      try {

        for (capture of captures) {

          let cid = capture.capture.id;
          let net = capture.capture.what.net;
          let now = capture.capture.time;
          let obj = capture.source;

          if (net.DOMContentLoaded && obj === topload.capture.source) {
            this.DOMContentLoaded_time = now;
            this.DOMContentLoaded_cid = cid;
          }
          if (net.FirstPaint && obj === topload.capture.source) {
            this.FirstPaint_time = now;
            this.FirstPaint_cid = cid;
          }

          if (net.ch_prio !== undefined) {
            let target = results.set(obj);
            if (target.transaction_cid) {
              ensure(target, "lateprio", []).push(net.ch_prio);
            } else {
              target.prio = net.ch_prio;
            }
            continue;
          }

          if (net.ch_cos !== undefined) {
            let target = results.set(obj);
            if (target.transaction_cid) {
              ensure(target, "latecos", []).push(net.ch_cos);
            } else {
              target.cos = net.ch_cos;
            }
            continue;
          }

          if (net.ch_open) {
            if (obj === channel) {
              state = STATE.AFTER_OPEN;
            }
            results.set(obj, {
              open_state: state,
              open_time: now,
              open_cid: cid,
            });
            continue;
          }

          if (net.ch_tailed !== undefined) {
            let target = results.set(obj);
            if (net.ch_tailed) {
              target.tail_start_time = now;
            } else {
              target.tail_end_time = now;
            }
            continue;
          }

          if (net.ch_trans) {
            results.set(obj, {
              transaction_time: now,
              transaction_cid: cid,
            });
            continue;
          }

          if (net.ch_tracker_recon) {
            results.set(obj, {
              tracker_time: now,
              tracker_cid: cid,
            });
            continue;
          }

          if (net.trans_active) {
            assert(obj === net.trans_active.httpchannel);
            if (!net.trans_active.httpconnection.networksocket) {
              console.log(net.trans_active.httpconnection);
            }
            assert(net.trans_active.httpconnection);
            assert(net.trans_active.httpconnection.networksocket);
            if (obj === channel) {
              state = STATE.AFTER_ACTIVATE;
            }
            results.set(obj, {
              activate_time: now,
              activate_cid: cid,
              throttle_intervals: 0,
              socket: net.trans_active.httpconnection.networksocket,
            });
            continue;
          }

          if (net.trans_send) {
            assert(obj === net.trans_send.httpchannel);
            let target = results.set(obj, {
              send_done_time: now, // rewrite
              send_done_cid: cid, // rewrite
            });

            if (obj === channel) {
              state = STATE.AFTER_SEND;
            } else if (state === STATE.AFTER_SEND) {
              target.sends_during_rtt = true;
            } else if (state === STATE.AFTER_RECV) {
              target.sends_during_response = true;
            }

            if (!target.sending) {
              target.sending = true;
              target.concur_BW = { wait_rx: 0, wait_tx: 0, recv_rx: 0, recv_tx: 0 };
              target.tx = 0;
              target.send = [];
            }

            target.send.push({ state: state, amount: net.amount, timestamp: now });
            target.tx += net.amount;

            results.allbut(target, ch => {
              if (ch.sending) {
                ch.concur_BW.wait_tx += net.amount;
              } else if (ch.receiving) {
                ch.concur_BW.recv_tx += net.amount;
              }
            });

            continue;
          }

          if (net.trans_recv) {
            assert(obj === net.trans_recv.httpchannel);
            let target = results.set(obj);

            if (obj === channel) {
              state = STATE.AFTER_RECV;
            } else if (state === STATE.AFTER_SEND) {
              target.recvs_during_rtt = true;
            } else if (state === STATE.AFTER_RECV) {
              target.recvs_during_response = true;
            }

            if (!target.receiving) {
              target.sending = false;
              target.receiving = true;
              target.recv_start_time = now;
              target.recv_start_cid = cid;
              target.rx = 0;
              target.recv = [];
            }

            target.recv.push({ state: state, amount: net.amount, timestamp: now });
            target.rx += net.amount;

            results.allbut(target, ch => {
              if (ch.sending) {
                ch.concur_BW.wait_rx += net.amount;
              } else if (ch.receiving) {
                ch.concur_BW.recv_rx += net.amount;
              }
            });

            continue;
          }

          if (net.trans_throttle) {
            assert(obj === net.trans_throttle.httpchannel);
            let target = results.set(obj);

            target.recv.push({ state: state, throttle: true, timestamp: now });
            target.throttle_begins = now;

            continue;
          }

          if (net.trans_unthrottle) {
            assert(obj === net.trans_unthrottle.httpchannel);
            let target = results.set(obj);

            target.recv.push({ state: state, throttle: false, timestamp: now });
            target.throttle_intervals += interval(now, target.throttle_begins);

            continue;
          }

          if (net.trans_throttle_pressure) {
            results.set(obj, { throttle_pressure: now });
            continue;
          }

          if (net.trans_done) {
            assert(obj === net.trans_done.httpchannel);
            let target = results.set(obj, {
              sending: false,
              receiving: false,
              recv_done_time: now,
              recv_done_cid: cid,
              done_state: state,
            });

            if (obj === channel) {
              state = STATE.AFTER_STOP;
            }

            continue;
          }

          if (net.ch_stop) {
            results.set(obj, {
              callonstop_time: now
            });

            continue;
          }

          // console.warn("unprocessed");
        }

        console.log("data collected");

        channel = results.set(channel);

        let interest = this.addResultSection("Channel of interest (ChoI)");
        let before_opened = this.addResultSection("Channels finished before ChoI opening");
        let between_open_and_activation = this.addResultSection("Channels active between ChoI opening and activation");
        let active_lower_prio_before_done = this.addResultSection("Lower priority channels active before ChoI was done");
        let active_lower_prio_before_active = this.addResultSection("Lower priority channels active before ChoI activation");
        let active_lower_prio_non_leader_before_done = this.addResultSection("Lower priority non-leader channels active before ChoI was done");
        let open_lower_prio_non_leader_before_open = this.addResultSection("Lower priority non-leader channels opened before ChoI open");
        let leaders_blocking = this.addResultSection("Leaders blocking ChoI");
        let blocking_socket = this.addResultSection("Channels blocking on the ChoI loading socket");
        let h1_concurrent = this.addResultSection("Parallel h1/2 to ChoI during active phase");
        let h2_concurrent = this.addResultSection("Sharing h2 session with ChoI during active phase");
        let recvs_during_rtt = this.addResultSection("Channels receiving during RTT");
        let sends_during_rtt = this.addResultSection("Channels sending during RTT");
        let recvs_during_response = this.addResultSection("Channels receiving during response");
        let sends_during_response = this.addResultSection("Channels sending during response");
        let non_leaders_before_first_paint = this.addResultSection("Non-leaders finished before first-paint");
        let open_before_first_paint_done_after_first_paint = this.addResultSection("Channels crossing first-paint (open before, done after)");
        let trackers_active_before_active = this.addResultSection("Trackers active before ChoI activation");
        let tailable_active_before_active = this.addResultSection("Tail-eligible active before ChoI activation");
        let tailed_active_before_active = this.addResultSection("Have been untailed before ChoI activation");
        let tailed_before_active = this.addResultSection("Still being tailed during ChoI activation");
        let never_tailed_trackers_after_DCL = this.addResultSection("Never tailed trackers finished after DOMContentLoaded");

        this.addHttpChannelResult(UI, interest, channel, true);
        results.allbut(channel, (result) => {
          if (!result.obj || result.obj.props.className !== "nsHttpChannel") {
            return;
          }

          if (result.recv_done_cid < channel.open_cid)
          {
            this.addHttpChannelResult(UI, before_opened, result);
          }

          if (result.activate_cid < channel.activate_cid &&
              result.prio > channel.prio) {
            this.addHttpChannelResult(UI, active_lower_prio_before_active, result).warn();
          }

          if (result.activate_cid < channel.recv_done_cid &&
            result.prio > channel.prio) {
            this.addHttpChannelResult(UI, active_lower_prio_before_done, result).warn();
          }

          if (result.activate_cid < channel.recv_done_cid &&
              result.prio > channel.prio &&
              !ClassOfServiceFlags.isLeaderOrUrgent(result.cos))
          {
            this.addHttpChannelResult(UI, active_lower_prio_non_leader_before_done, result).warn();
          }

          if (result.open_cid < channel.open_cid &&
              result.prio > channel.prio &&
              !ClassOfServiceFlags.isLeaderOrUrgent(result.cos))
          {
            this.addHttpChannelResult(UI, open_lower_prio_non_leader_before_open, result).warn();
          }

          if (ClassOfServiceFlags.isLeader(result.cos) && result.recv_done_cid < channel.open_cid) {
            this.addHttpChannelResult(UI, leaders_blocking, result);
          }

          if (result.activate_cid > channel.open_cid &&
              result.activate_cid < channel.activate_cid)
          {
            this.addHttpChannelResult(UI, between_open_and_activation, result);
          }

          let h2 = false;
          if ((result.rx !== undefined || result.tx !== undefined) && // received something during the period and
              result.recv_done_cid > channel.activate_cid && // done after the channel activation time
              result.activate_cid < channel.recv_done_cid) // and activated before the channel is done
          {
            if (channel.socket !== result.socket) {
              this.addHttpChannelResult(UI, h1_concurrent, result);
            } else {
              this.addHttpChannelResult(UI, h2_concurrent, result);
              h2 = true;
            }
          }

          if (!h2 && result.socket == channel.socket &&
            result.recv_done_cid > channel.open_cid &&
            result.recv_done_cid < channel.recv_start_cid) {
            this.addHttpChannelResult(UI, blocking_socket, result).warnIf(result.throttle_intervals);
          }

          if (result.sends_during_rtt) {
            this.addHttpChannelResult(UI, sends_during_rtt, result);
          }
          if (result.recvs_during_rtt) {
            this.addHttpChannelResult(UI, recvs_during_rtt, result);
          }
          if (result.sends_during_response) {
            this.addHttpChannelResult(UI, sends_during_response, result);
          }
          if (result.recvs_during_response) {
            this.addHttpChannelResult(UI, recvs_during_response, result);
          }

          if (result.recv_done_cid < this.FirstPaint_cid &&
              !ClassOfServiceFlags.isLeaderOrUrgent(result.cos))
          {
            this.addHttpChannelResult(UI, non_leaders_before_first_paint, result).warn();
          }

          if (result.open_cid < this.FirstPaint_cid && result.recv_done_cid > this.FirstPaint_cid) {
            this.addHttpChannelResult(UI, open_before_first_paint_done_after_first_paint, result);
          }

          if (this.isTracker(result.obj) &&
              result.activate_cid < channel.activate_cid)
          {
            this.addHttpChannelResult(UI, trackers_active_before_active, result).warn();
          }
          if (ClassOfServiceFlags.isTailable(result.cos) &&
              result.activate_cid < channel.activate_cid)
          {
            this.addHttpChannelResult(UI, tailable_active_before_active, result).warn();
          }
          if (result.tail_start_time &&
              result.activate_cid < channel.activate_cid)
          {
            this.addHttpChannelResult(UI, tailed_active_before_active, result).warn();
          }
          if (result.tail_start_time &&
            result.open_cid < channel.activate_cid &&
            (!result.activate_cid || result.activate_cid > channel.activate_cid)) {
            this.addHttpChannelResult(UI, tailed_before_active, result).emph();
          }
          if (!result.tail_start_time && this.isTracker(result.obj) &&
              result.recv_done_cid > this.DOMContentLoaded_cid) {
            this.addHttpChannelResult(UI, never_tailed_trackers_after_DCL, result).warn();
          }
        });

        this.element.collapse({ accordion: false });
        interest.prev("h3").find("a").trigger("open");

        console.log("data shown");
      } catch (ex) {
        console.warn(ex);
      }
    },

    addResultSection: function(name) {
      this.element.append($("<h3>").text(name).append($("<span>").text(" (0)")));
      let section = $("<div>");
      this.element.append(section);
      return section;
    },

    addHttpChannelResult: function(UI, element, result, nobutton = false) {
      if (result.obj.props.className !== "nsHttpChannel") {
        return;
      }

      let counter = element.prev("h3").find("span");
      let ctrl = {
        warn: function() {
          counter.css({ color: "red" });
        },
        warnIf: function(cond) {
          if (cond) this.warn();
        },
        emph: function() {
          counter.css({ color: "green" });
        },
      };

      let node = $("<div>").addClass("netd-result");
      if (!nobutton) {
        node.append($("<input>")
            .attr("type", "button")
            .addClass("button")
            .val("diagnose")
            .click(function() {
              this.diagnose(UI, result.obj);
            }.bind(this))
        );
        node.append($("<input>")
            .attr("type", "button")
            .addClass("button")
            .val("add to search results")
            .click(function() {
              UI.setResultsView();
              UI.addSearch({
                className: result.obj.props.className,
                propName: "logid",
                value: result.obj.id,
                matching: "==",
              });
            }.bind(this))
        );
      }

      add = (name, value) => {
        let line = $("<div>");
        line.append($("<span>").addClass("bold").html(UI.escapeHtml(name)));
        if (value !== undefined) {
          line.append($("<span>").html(" = " + value));
        }
        node.append(line);
        return line;
      };

      add("URL", result.obj.props.url);
      add("class-of-service", cosString(result.cos));
      if (result.latecos) {
        add("class-of-service after creating transaction", result.latecos.map(cos => cosString(cos)).join("|"));
        ctrl.warn();
      }
      add("priority", result.prio);
      if (result.lateprio) {
        add("priority after creating transaction", result.lateprio.join("|"));
      }
      if (this.isTracker(result.obj)) {
        add("is a tracker").css({ color: "red" });
      } else {
        add("not a tracker");
      }
      if (this.isLocalBlockList(result.obj)) {
        add("is on local block list").css({ color: "red" });
      } else {
        add("not on local block list");
      }
      if (result.tail_start_time) {
        add("tailed for", interval_t(result.tail_end_time, result.tail_start_time)).css({ color: "green" });
      }
      add("opened since document load", interval_t(result.open_time, this.begintime));
      add("time to create transaction", interval_t(result.transaction_time, result.open_time));
      if (result.tracker_time) {
        add("tracker recognition time relative to transaction creation time", interval_t(result.tracker_time, result.transaction_time));
        add("tracker recognition before transaction", result.tracker_cid < result.transaction_cid);
      }
      add("transaction activated after", interval_t(result.activate_time, result.transaction_time));
      add("sending request done in", interval_t(result.send_done_time, result.activate_time));
      add("sent amount", result.tx);
      add("getting response after (RTT)", interval_t(result.recv_start_time, result.send_done_time));
      add("getting response since document load", interval_t(result.recv_start_time, this.begintime));
      add("recv amount", result.rx);
      if (result.throttle_intervals) {
        add("throttled for", target.throttle_intervals).css({ color: "red" });
      }
      if (result.throttle_pressure) {
        add("conn-entry pressure stopping throttle after", interval_t(result.throttle_pressure, result.activate_time)).css({ color: "red" });
      }
      add("response complete after", interval_t(result.recv_done_time, result.recv_start_time));
      add("response complete since document load", interval_t(result.recv_done_time, this.begintime));
      add("OnStopRequest call delay", interval_t(result.callonstop_time, result.recv_done_time));
      if (result.concur_BW) {
        add("during RTT concurrent TX", result.concur_BW.wait_tx);
        add("during RTT concurrent RX", result.concur_BW.wait_rx);
        add("during response concurrent TX", result.concur_BW.recv_tx);
        add("during response concurrent RX", result.concur_BW.recv_rx);
      }
      add("opened before DOMContentLoaded", result.open_cid < this.DOMContentLoaded_cid);
      add("finished before DOMContentLoaded", result.recv_done_cid <= this.DOMContentLoaded_cid);
      add("opened before FirstPaint", result.open_cid <= this.FirstPaint_cid);
      add("finished before FirstPaint", result.recv_done_cid <= this.FirstPaint_cid);

      element.append(node);
      counter.text(" (" + element.children("div").length + ")");

      return ctrl;
    },

    isTracker: function(ch) {
      return ch.props["tracker"] === true;
    },

    isLocalBlockList: function(ch) {
      return ch.props["local-block-list"] === true;
    },

    /*
    addSocket: function(sock) {
      this.element.append($("<div>")
        .addClass("netd-socket")
        .css(this.csspos(sock))
        .text(sock.props.host)
      );
    },

    width: function(timestamp1, timestamp2) {
      timestamp2 = Math.min(this.endtime.getTime(), timestamp2.getTime());
      return Math.max(0, Math.min(100, ((timestamp2 - timestamp1.getTime()) / (this.endtime.getTime() - this.begintime.getTime()) * 100))) + "%";
    },
    screen: function(timestamp) {
      return this.width(this.begintime, timestamp);
    },
    csspos: function(obj) {
      return {
        left: this.screen(obj.captures[0].time),
        width: this.width(obj.captures[0].time, obj.captures.last().time)
      }
    },
    */
  };

})();
