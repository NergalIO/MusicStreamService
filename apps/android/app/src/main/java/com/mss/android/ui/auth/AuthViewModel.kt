package com.mss.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.android.data.SessionLog
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
    private val sessionLog: SessionLog,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "")

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _authVerify = MutableStateFlow(false)
    val authVerify: StateFlow<Boolean> = _authVerify
    private val _authInfo = MutableStateFlow<String?>(null)
    val authInfo: StateFlow<String?> = _authInfo
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    fun setApiBase(url: String) = viewModelScope.launch { repo.setApiBase(url) }

    fun enterUiPreview() = viewModelScope.launch { repo.enterUiPreview() }

    fun login(email: String, password: String, register: Boolean, apiBaseUrl: String) {
        viewModelScope.launch {
            _error.value = null
            val base = apiBaseUrl.trim().trimEnd('/')
            if (!base.startsWith("http://") && !base.startsWith("https://")) {
                _error.value = "Укажите адрес сервера, например https://example.com/MusicStreamService"
                return@launch
            }
            _busy.value = true
            runCatching {
                repo.setApiBase(base)
                if (register) {
                    val pending = repo.register(email, password)
                    _authVerify.value = true
                    _authInfo.value = "Код отправлен на ${pending.email}"
                    sessionLog.info("auth", "register mss pending verify")
                } else {
                    repo.login(email, password)
                    _authVerify.value = false
                    sessionLog.info("auth", "login mss")
                }
            }.onFailure { e ->
                if (e is EmailNotVerifiedException) {
                    _authVerify.value = true
                    _authInfo.value = e.message
                    sessionLog.info("auth", "login mss needs verify")
                } else {
                    sessionLog.error("auth", e.message ?: "login failed")
                    _error.value = e.message
                }
            }
            _busy.value = false
        }
    }

    fun verifyEmail(email: String, code: String) = viewModelScope.launch {
        runCatching {
            repo.verifyEmail(email, code)
            _authVerify.value = false
            sessionLog.info("auth", "verify email")
        }.onFailure {
            sessionLog.error("auth", it.message ?: "verify failed")
            _error.value = it.message
        }
    }

    fun resendVerification(email: String, password: String) = viewModelScope.launch {
        runCatching {
            repo.resendVerification(email, password)
            _authInfo.value = "Новый код отправлен"
        }.onFailure {
            sessionLog.error("auth", it.message ?: "resend failed")
            _error.value = it.message
        }
    }

    fun cancelVerify() {
        _authVerify.value = false
        _authInfo.value = null
    }
}
