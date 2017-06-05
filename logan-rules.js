logan.rule("Creating HttpChannelParent [this=%p]", function(ptr)
{
  this.thread.httpchannelparent = this.create(ptr, "HttpChannelParent");
});
logan.rule("Destroying HttpChannelParent [this=%p]", function(ptr)
{
  this.destroy(ptr);
});


logan.rule("Creating nsHttpChannel [this=%p]", function(ptr) 
{
  this.thread.httpchannel = this.create(ptr, "nsHttpChannel");
  if (this.thread.httpchannelparent) {
    this.link(this.thread.httpchannelparent, this.thread.httpchannel);
  }
});
logan.ruleIf("uri=%s", function() { return !!this.thread.httpchannel; }, function(url) 
{
  this.prop(this.thread.httpchannel, "url", url);
});
logan.rule("Destroying nsHttpChannel [this=%p]", function(ptr) 
{
  this.destroy(ptr);
});

