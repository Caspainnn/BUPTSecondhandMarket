Component({
  properties: { src: String, mode: { type: String, value: 'scaleToFill' }, lazyLoad: Boolean },
  data: { resolvedSrc: '' },
  observers: { src(src) { this.resolveSource(src) } },
  lifetimes: { detached() { this.sourceToken = null } },
  methods: {
    async resolveSource(src) {
      const token = {}
      this.sourceToken = token
      this.setData({ resolvedSrc: '' })
      if (!src) return
      if (!src.startsWith('cloud://')) { this.setData({ resolvedSrc: src }); return }
      try {
        const result = await wx.cloud.getTempFileURL({ fileList: [src] })
        if (this.sourceToken !== token) return
        const file = result.fileList.find(item => item.fileID === src)
        if (!file || file.status !== 0 || !/^https:\/\//.test(file.tempFileURL || '')) throw new Error('云图片地址解析失败，请检查文件和读取权限')
        this.setData({ resolvedSrc: file.tempFileURL })
      } catch (error) {
        if (this.sourceToken === token) this.triggerEvent('error', { errMsg: error.message || error.errMsg || '云图片加载失败' })
      }
    },
    onError(event) { this.triggerEvent('error', event.detail) },
    onLoad(event) { this.triggerEvent('load', event.detail) },
  },
})
