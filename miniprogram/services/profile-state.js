const emptyForm = {
  nickname: '',
  avatarFileId: '',
  avatarPreview: '',
  campusId: '',
}

function createProfileState(overrides = {}) {
  return {
    status: 'idle',
    error: '',
    user: null,
    form: { ...emptyForm, ...(overrides.form || {}) },
    ...overrides,
  }
}

function reduceProfileState(state, event) {
  switch (event.type) {
    case 'PATCH_FORM':
      return {
        ...state,
        error: '',
        form: { ...state.form, ...event.patch },
      }
    case 'UPLOAD_START':
      return { ...state, status: 'uploading', error: '' }
    case 'UPLOAD_SUCCESS':
      return {
        ...state,
        status: 'idle',
        error: '',
        form: {
          ...state.form,
          avatarFileId: event.avatarFileId,
          avatarPreview: event.avatarPreview,
        },
      }
    case 'SAVE_START':
      return { ...state, status: 'saving', error: '' }
    case 'SAVE_SUCCESS':
      return { ...state, status: 'success', error: '', user: event.user }
    case 'FAILURE':
      return { ...state, status: 'error', error: event.message }
    case 'RETRY':
      return { ...state, status: 'idle', error: '' }
    default:
      return state
  }
}

module.exports = { createProfileState, reduceProfileState }
