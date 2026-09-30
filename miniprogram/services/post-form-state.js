const emptyForm = {
  title: '',
  description: '',
  images: [],
  categoryId: '',
  price: '',
  totalQuantity: 1,
  conditionId: '',
  defectDescription: '',
  campusId: '',
}

function createPostFormState(overrides = {}) {
  return {
    status: 'idle',
    error: '',
    requestId: '',
    createdPost: null,
    ...overrides,
    mode: overrides.mode || 'create',
    form: {
      ...emptyForm,
      ...(overrides.form || {}),
      images: [...((overrides.form && overrides.form.images) || [])],
    },
  }
}

function reducePostFormState(state, event) {
  switch (event.type) {
    case 'PATCH_FORM': {
      const form = { ...state.form, ...event.patch }
      if (event.patch.conditionId && event.patch.conditionId !== 'partially_faulty') form.defectDescription = ''
      return { ...state, error: '', form }
    }
    case 'ADD_IMAGES':
      return { ...state, error: '', form: { ...state.form, images: [...state.form.images, ...event.images].slice(0, 6) } }
    case 'REMOVE_IMAGE':
      return { ...state, error: '', form: { ...state.form, images: state.form.images.filter((_, index) => index !== event.index) } }
    case 'MOVE_IMAGE': { const images = [...state.form.images]; const [image] = images.splice(event.from, 1); if (image) images.splice(event.to, 0, image); return { ...state, form: { ...state.form, images } } }
    case 'UPLOAD_START':
      return state.status === 'saving' ? state : { ...state, status: 'uploading', error: '' }
    case 'UPLOAD_SUCCESS':
      return { ...state, status: 'idle', error: '', form: { ...state.form, images: state.form.images.map((image, index) => ({ ...image, fileId: event.fileIds[index] })) } }
    case 'SAVE_START':
      if (state.status === 'saving' || state.status === 'uploading') return state
      return { ...state, status: 'saving', error: '', requestId: state.requestId || event.requestId }
    case 'SAVE_SUCCESS':
      return { ...state, status: 'success', error: '', createdPost: event.post, form: state.mode === 'create' ? { ...emptyForm } : state.form }
    case 'FAILURE':
      return { ...state, status: 'error', error: event.message }
    case 'RETRY':
      return { ...state, status: 'idle', error: '' }
    default:
      return state
  }
}

module.exports = { createPostFormState, reducePostFormState }
