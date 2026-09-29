package com.mss.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.core.network.EmailNotVerifiedException
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repo: MssRepository,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "http://10.0.2.2:3001")

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _authVerify = MutableStateFlow(false)
    val authVerify: StateFlow<Boolean> = _authVerify
    private val _authInfo = MutableStateFlow<String?>(null)
    val authInfo: StateFlow<String?> = _authInfo

    fun setApiBase(url: String) = viewModelScope.launch { repo.setApiBase(url) }

    fun login(email: String, password: String, register: Boolean) {
        viewModelScope.launch {
            _error.value = null
            runCatching {
                if (register) {
                    val pending = repo.register(email, password)
                    _authVerify.value = true
                    _authInfo.value = "Код отправлен на ${pending.email}"
                } else {
                    repo.login(email, password)
                    _authVerify.value = false
                }
            }.onFailure { e ->
                if (e is EmailNotVerifiedException) {
                    _authVerify.value = true
                    _authInfo.value = e.message
                } else _error.value = e.message
            }
        }
    }

    fun verifyEmail(email: String, code: String) = viewModelScope.launch {
        runCatching {
            repo.verifyEmail(email, code)
            _authVerify.value = false
        }.onFailure { _error.value = it.message }
    }

    fun resendVerification(email: String, password: String) = viewModelScope.launch {
        runCatching {
            repo.resendVerification(email, password)
            _authInfo.value = "Новый код отправлен"
        }.onFailure { _error.value = it.message }
    }

    fun cancelVerify() {
        _authVerify.value = false
        _authInfo.value = null
    }
}
