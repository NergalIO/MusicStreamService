package com.mss.android.ui.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.mss.android.BuildConfig
import com.mss.android.ui.components.BrandMark
import com.mss.android.ui.components.MssField
import com.mss.android.ui.theme.rememberMssWindow

@Composable
fun LoginScreen(vm: AuthViewModel = hiltViewModel()) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val error by vm.error.collectAsState()
    val verify by vm.authVerify.collectAsState()
    val info by vm.authInfo.collectAsState()
    val url by vm.apiBase.collectAsState()
    val busy by vm.busy.collectAsState()
    var api by remember { mutableStateOf(url) }
    val window = rememberMssWindow()
    val submit = {
        if (!busy) vm.login(email, password, register)
    }

    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(if (window.compact) 16.dp else 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = if (window.short || window.landscape) Arrangement.Top else Arrangement.Center,
    ) {
        Card(
            modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        ) {
            Column(
                Modifier.padding(if (window.compact) 16.dp else 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (window.compact) {
                    Column(
                        Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        BrandMark()
                        Text(
                            "MusicStreamService",
                            style = MaterialTheme.typography.titleLarge,
                            textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        BrandMark()
                        Text(
                            "MusicStreamService",
                            style = MaterialTheme.typography.headlineSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                }
                Text(
                    if (verify) "Подтверждение почты" else "Войдите в свой аккаунт",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f))
                            .padding(12.dp),
                    )
                }
                info?.let {
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                if (!verify) {
                    MssField(
                        api, { api = it },
                        placeholder = "https://…",
                        label = "URL API",
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                    TextButton({ vm.setApiBase(api) }) { Text("Сохранить URL") }
                    MssField(
                        email, { email = it },
                        placeholder = "Email",
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    )
                    MssField(
                        password, { password = it },
                        placeholder = "Пароль",
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                    Button(
                        onClick = {
                            vm.setApiBase(api)
                            submit()
                        },
                        enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (register) "Регистрация" else "Войти")
                    }
                    TextButton({ register = !register }, Modifier.fillMaxWidth()) {
                        Text(if (register) "Уже есть аккаунт?" else "Создать аккаунт")
                    }
                    if (BuildConfig.DEBUG) {
                        Spacer(Modifier.height(4.dp))
                        TextButton({ vm.enterUiPreview() }, Modifier.fillMaxWidth()) {
                            Text("Открыть интерфейс без сервера")
                        }
                    }
                } else {
                    MssField(
                        code,
                        { code = it.filter(Char::isDigit).take(6) },
                        placeholder = "6-значный код",
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (code.length == 6) vm.verifyEmail(email, code) }),
                    )
                    Button(
                        { vm.verifyEmail(email, code) },
                        enabled = code.length == 6 && !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Подтвердить") }
                    TextButton({ vm.resendVerification(email, password) }, Modifier.fillMaxWidth()) {
                        Text("Отправить код снова")
                    }
                    TextButton({ vm.cancelVerify() }, Modifier.fillMaxWidth()) { Text("Назад") }
                }
            }
        }
    }
}
