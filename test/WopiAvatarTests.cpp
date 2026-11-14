/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */
#include <config.h>

#include <common/Anonymizer.hpp>
#include <common/JsonUtil.hpp>
#include <test/test.hpp>
#include <wsd/wopi/WopiStorage.hpp>
#include <Poco/Util/Application.h>
#include <cppunit/extensions/HelperMacros.h>
#include <memory>

namespace
{
class AvatarTestApplication : public Poco::Util::Application
{
public:
    ~AvatarTestApplication() override = default;
};
}

class WopiAvatarTests : public CPPUNIT_NS::TestFixture
{
    CPPUNIT_TEST_SUITE(WopiAvatarTests);
    CPPUNIT_TEST(testEmptyProfile);
    CPPUNIT_TEST(testMailWithoutAvatar);
    CPPUNIT_TEST(testPresentAvatarIsAnonymized);
    CPPUNIT_TEST_SUITE_END();

    bool _wasEnabled = false;
    std::unique_ptr<AvatarTestApplication> _application;

    static Poco::JSON::Object::Ptr loadProfile(const std::string& json)
    {
        Poco::JSON::Object::Ptr extra;
        CPPUNIT_ASSERT(JsonUtil::parseJSON(json, extra));
        Poco::JSON::Object::Ptr object = new Poco::JSON::Object();
        object->set("UserId", "test-user");
        object->set("UserFriendlyName", "Test Author");
        object->set("UserExtraInfo", extra);
        const StorageBase::FileInfo file(1, "sample.docx", "test-user", "2026-11-14T12:00:00Z");
        const WopiStorage::WOPIFileInfo info(file, object, Poco::URI("http://localhost/wopi/test"));
        CPPUNIT_ASSERT_EQUAL(std::string("Test Author"), info.getUsername());
        Poco::JSON::Object::Ptr result;
        CPPUNIT_ASSERT(JsonUtil::parseJSON(info.getUserExtraInfo(), result));
        return result;
    }

public:
    void setUp() override
    {
        if (isStandalone())
            _application = std::make_unique<AvatarTestApplication>();
        _wasEnabled = Anonymizer::enabled();
        if (!_wasEnabled)
            Anonymizer::initialize(true, Anonymizer::DefaultSalt);
    }

    void tearDown() override
    {
        if (!_wasEnabled)
            Anonymizer::initialize(false, Anonymizer::DefaultSalt);
        _application.reset();
    }

    void testEmptyProfile()
    {
        CPPUNIT_ASSERT(!loadProfile("{}")->has("avatar"));
    }

    void testMailWithoutAvatar()
    {
        const auto profile = loadProfile(R"({"mail":"author@example.com"})");
        CPPUNIT_ASSERT(!profile->has("avatar"));
        CPPUNIT_ASSERT_EQUAL(std::string("author@example.com"), profile->getValue<std::string>("mail"));
    }

    void testPresentAvatarIsAnonymized()
    {
        const auto profile = loadProfile(R"({"avatar":"https://example.com/avatar/test-user/96"})");
        const auto avatar = profile->getValue<std::string>("avatar");
        CPPUNIT_ASSERT(avatar.starts_with("https://example.com/avatar/"));
        CPPUNIT_ASSERT(avatar.find("test-user") == std::string::npos);
        CPPUNIT_ASSERT(avatar.ends_with("/96"));
    }
};

CPPUNIT_TEST_SUITE_REGISTRATION(WopiAvatarTests);
