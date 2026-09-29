package com.mss.android.ui.lobby

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.core.lobby.LobbyClient
import com.mss.core.model.LobbySummaryDto
import com.mss.core.model.UnifiedTrack
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class LobbyViewModel @Inject constructor(
    private val repo: MssRepository,
    private val lobby: LobbyClient,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val lobbyState = lobby.lobby.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    private val _list = MutableStateFlow<List<LobbySummaryDto>>(emptyList())
    val list: StateFlow<List<LobbySummaryDto>> = _list
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun refresh() = launch { _list.value = lobby.refreshList().items }

    fun create(title: String, pub: Boolean) = launch { lobby.create(title, pub) }

    fun join(code: String) = launch { lobby.join(code) }

    fun leave() = launch { lobby.leave() }

    fun suggest(track: UnifiedTrack) = launch { lobby.suggest(track) }

    fun accept(itemId: String) = launch { lobby.accept(itemId) }

    fun reject(itemId: String) = launch { lobby.reject(itemId) }

    fun isHost(): Boolean = lobby.isHost(session.value?.user?.id)

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch {
            _error.value = null
            runCatching { block() }.onFailure { _error.value = it.message }
        }
    }
}
